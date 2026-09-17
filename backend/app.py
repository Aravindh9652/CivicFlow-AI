from flask import Flask, request, jsonify
from flask_cors import CORS
import os, json, smtplib, tempfile
from email.message import EmailMessage
from dotenv import load_dotenv
import google.generativeai as genai

from civic_intelligence import (
    AUTHORITY_EMAIL,
    DEPARTMENTS,
    INDIA_EMERGENCY_NUMBER,
    SLA_MINUTES,
    cluster_grievances,
    find_duplicates,
    insights_from_items,
    validate_and_normalize,
)
from local_ai import analyze_hybrid, first_pass
from demo_data import DEMO_GRIEVANCES

# ---------------- SETUP ----------------
load_dotenv()

app = Flask(__name__)
CORS(app)

# ---------------- GEMINI CONFIG ----------------
# EXISTING GEMINI INTEGRATION — intentionally preserved (google.generativeai).
# Do not migrate to google.genai.
if os.getenv("GEMINI_API_KEY"):
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
GEMINI_MODEL = "models/gemini-flash-latest"

# ---------------- EMAIL CONFIG ----------------
SENDER_EMAIL = os.getenv("SENDER_EMAIL")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD")

# Same email for all departments (hackathon demo)
# AUTHORITY_EMAIL imported from civic_intelligence (env-overridable)

# ---------------- EMAIL HELPER ----------------
def send_email(to_email, subject, body, attachments=None):
    msg = EmailMessage()
    msg["From"] = f"CivicFlow AI Support <{SENDER_EMAIL}>" if SENDER_EMAIL else "CivicFlow AI Support"
    msg["To"] = to_email
    msg["Reply-To"] = SENDER_EMAIL
    msg["Subject"] = subject
    msg.set_content(body)

    if attachments:
        for file in attachments:
            if file and file.filename:
                msg.add_attachment(
                    file.read(),
                    maintype="application",
                    subtype="octet-stream",
                    filename=file.filename
                )

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.send_message(msg)


def _gemini_prompt(user_message: str, city: str) -> str:
    return f"""
You are the civic intelligence layer of CivicFlow AI.

Analyze the citizen's complaint carefully and return ONLY valid JSON.
Do not add markdown, explanations, or text outside the JSON.

IMPORTANT:
- Understand the meaning and context of the complaint, not just individual keywords.
- Select the MOST appropriate responsible department.
- Do NOT guess a department merely from one keyword.
- Consider the actual civic issue, requested action, location/context,
  safety implications, and the authority normally responsible.
- If the issue is ambiguous, choose the best-supported department and
  lower the confidence.
- Do not invent facts that the citizen did not provide.
- NEVER claim that police, ambulance, or any department was already contacted.

CONTROLLED DEPARTMENTS:
- Municipal
- Water
- Electricity
- Police
- Health
- General

DEPARTMENT GUIDANCE:
- Roads, potholes, garbage, sanitation, drainage, public infrastructure
  → normally Municipal
- Water supply, water leakage, contaminated water
  → normally Water
- Streetlights, electrical infrastructure, exposed electrical wiring
  → normally Electricity
- Crime, theft, assault, armed threats, criminal activity
  → Police
- Medical emergencies and public-health issues
  → Health
- If no department can reasonably be determined
  → General

IMPORTANT:
Emergency status is NOT determined only by department.

Any department can have either a normal or emergency grievance.

Examples:
- Municipal + normal: ordinary garbage accumulation
- Municipal + emergency: building collapse or major public road danger
- Water + normal: minor water leakage
- Water + emergency: major pipeline burst flooding homes
- Electricity + normal: ordinary streetlight failure
- Electricity + emergency: exposed live wires or active electrical fire
- Police + normal: non-urgent civic/police complaint
- Police + emergency: active armed violence or immediate threat to life
- Health + normal: routine public-health complaint
- Health + emergency: unconscious person or severe medical emergency

EMERGENCY RULE:
Set emergency=true ONLY when the complaint contains evidence of an
immediate or potentially immediate serious threat to life, physical safety,
or major public safety.

Do NOT mark a complaint as an emergency simply because it is inconvenient,
important, unpleasant, or high priority.

If emergency=true:
- severity should normally be Critical
- priorityScore should normally be very high
- emergencyReason must clearly state the evidence
- advice should prioritize immediate safe action and a one-tap call to 112
- Never say you dispatched help

If emergency=false:
- use normal civic grievance handling
- emergencyReason should explain why no immediate emergency is indicated

PRIORITY GUIDANCE:
- CRITICAL: immediate serious threat to life or major public safety danger
- HIGH: significant safety/public-health/infrastructure impact or rapidly
  worsening issue
- MEDIUM: meaningful civic problem requiring action without immediate
  major danger
- LOW: minor/non-urgent issue

Return EXACTLY this JSON structure:

{{
  "department": "Municipal / Water / Electricity / Police / Health / General",
  "category": "specific civic issue category",
  "summary": "concise understanding of the complaint",

  "emergency": false,
  "emergencyReason": "why this is or is not an emergency",

  "severity": "Critical / High / Medium / Low",
  "priorityScore": 0,
  "priorityReason": "specific evidence-based reason for the priority",

  "routingReason": "why this department is responsible",
  "confidence": 0.0,

  "advice": "practical next steps for the citizen",
  "draftedMail": "formal grievance email"
}}

NUMERIC RULES:
- priorityScore must be an integer from 0 to 100.
- confidence must be a number from 0.0 to 1.0.
- Do not exaggerate priority.
- Do not exaggerate confidence.
- Do not invent information.
- Emergency status must be supported by the complaint.

Complaint:
{user_message}

City / Area:
{city}
"""


def _run_gemini(user_message: str, city: str, image_path: str | None = None) -> dict | None:
    if not os.getenv("GEMINI_API_KEY"):
        return None
    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        prompt = _gemini_prompt(user_message, city)
        if image_path:
            try:
                import PIL.Image
                img = PIL.Image.open(image_path)
                response = model.generate_content(
                    [
                        prompt
                        + "\nAn evidence photo is attached. Use it only as supporting "
                          "context. Do not invent objects that are not visible.",
                        img,
                    ]
                )
            except Exception:
                response = model.generate_content(prompt)
        else:
            response = model.generate_content(prompt)

        raw = response.text.strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start == -1 or end <= start:
            raise ValueError("Gemini did not return valid JSON")
        ai_json = json.loads(raw[start:end])

        department = ai_json.get("department")
        severity = ai_json.get("severity")
        priority_score = ai_json.get("priorityScore")
        confidence = ai_json.get("confidence")
        emergency = ai_json.get("emergency")

        if department not in set(DEPARTMENTS):
            raise ValueError("Invalid department returned by AI")
        if severity not in {"Critical", "High", "Medium", "Low"}:
            raise ValueError("Invalid severity returned by AI")
        if not isinstance(priority_score, int) or not 0 <= priority_score <= 100:
            raise ValueError("Invalid priority score returned by AI")
        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise ValueError("Invalid confidence returned by AI")
        if not isinstance(emergency, bool):
            raise ValueError("Invalid emergency flag returned by AI")
        if emergency and severity != "Critical":
            raise ValueError("Emergency grievance must have Critical severity")

        ai_json["aiUsed"] = True
        ai_json["mailTo"] = AUTHORITY_EMAIL
        return ai_json
    except Exception:
        return None


def _analyze(user_message: str, city: str, image_path: str | None = None, image_hint: str = "") -> dict:
    local = first_pass(user_message, city, image_hint)
    cloud = _run_gemini(user_message, city, image_path)
    result = analyze_hybrid(user_message, city, cloud, image_hint)
    result.pop("embedding", None)
    result["mailTo"] = AUTHORITY_EMAIL
    if not result.get("aiUsed"):
        # Preserve previous fallback contract when Gemini is unavailable.
        result["aiUsed"] = False
    result["localPreview"] = {
        "department": local.get("department"),
        "emergency": local.get("emergency"),
        "priorityScore": local.get("priorityScore"),
        "severity": local.get("severity"),
        "localModel": local.get("localModel"),
    }
    return result


# ---------------- AI ANALYSIS ----------------
@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json() or {}

    user_message = data.get("message", "").strip()
    city = data.get("location", "").strip()

    if not user_message:
        return jsonify({
            "error": "Complaint message is required"
        }), 400

    result = _analyze(user_message, city)
    return jsonify(result), 200


@app.route("/analyze", methods=["POST"])
def analyze():
    """Multimodal intake: text + optional image + GPS metadata."""
    image_path = None
    tmp = None
    try:
        if request.content_type and request.content_type.startswith("multipart/form-data"):
            user_message = (request.form.get("message") or "").strip()
            city = (request.form.get("location") or "").strip()
            image_hint = (request.form.get("imageHint") or "").strip()
            image = request.files.get("image")
            if image and image.filename:
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
                image.save(tmp.name)
                image_path = tmp.name
        else:
            data = request.get_json() or {}
            user_message = (data.get("message") or "").strip()
            city = (data.get("location") or "").strip()
            image_hint = (data.get("imageHint") or "").strip()

        if not user_message:
            return jsonify({"error": "Complaint message is required"}), 400

        result = _analyze(user_message, city, image_path, image_hint)
        return jsonify(result), 200
    finally:
        if tmp is not None:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass


@app.route("/duplicates", methods=["POST"])
def duplicates():
    data = request.get_json() or {}
    candidate = data.get("candidate") or {}
    existing = data.get("existing") or []
    matches = find_duplicates(candidate, existing)
    return jsonify({"matches": matches, "possibleDuplicate": bool(matches)})


@app.route("/clusters", methods=["POST"])
def clusters():
    data = request.get_json() or {}
    items = data.get("grievances") or []
    return jsonify({"clusters": cluster_grievances(items)})


@app.route("/insights", methods=["POST"])
def insights():
    data = request.get_json() or {}
    items = data.get("grievances") or []
    return jsonify({"insights": insights_from_items(items), "count": len(items)})


def _answer_assistant_query(question: str, problem: str, city: str, context: dict, analysis: dict) -> str:
    q = question.lower().strip()

    # 1. Direct Gemini Call for ANY real-world, general knowledge, tech, science, or civic question
    if os.getenv("GEMINI_API_KEY"):
        try:
            model = genai.GenerativeModel(GEMINI_MODEL)
            prompt = (
                "You are CivicFlow AI's helpful general assistant.\n"
                "Answer the user's question clearly, accurately, and politely in 2 to 4 sentences.\n"
                "You must answer ANY real-world question (e.g. about artificial intelligence, science, history, daily life, tech, or civic processes).\n\n"
                f"Question: {question}\n"
            )
            response = model.generate_content(prompt)
            if response and response.text:
                ans = response.text.strip()
                if ans:
                    return ans
        except Exception as err:
            print("Assistant Gemini direct Q&A notice:", err)

    # 2. Specific civic context overrides (if offline / fallback)
    if "department" in q or "who handles" in q or "rout" in q:
        return (
            f"Recommended department: {analysis['department']}. "
            f"{analysis['routingReason']} Confidence {int(analysis['confidence']*100)}%."
        )
    if "priority" in q or "severity" in q or "score" in q:
        return (
            f"Priority {analysis['priorityScore']}/100 ({analysis['severity']}). "
            f"{analysis['priorityReason']}"
        )
    if "status" in q or "track" in q:
        status = context.get("status") or "Not submitted yet"
        return f"Current tracked status: {status}. Authorities update this real-time from the command center."

    # 3. Rich general knowledge fallbacks when offline
    if "llm" in q or "large language model" in q or "ai" in q or "artificial intelligence" in q:
        return (
            "Artificial Intelligence (AI) is the simulation of human intelligence by computer systems, enabling machines to learn, reason, "
            "and solve problems. In CivicFlow AI, LLMs like Google Gemini automatically classify civic issues, calculate priority scores, "
            "and answer any questions you ask."
        )
    if "civicflow" in q or "what is this" in q or "how does" in q or "help" in q:
        return (
            "CivicFlow AI is an AI-powered civic grievance platform. You can report community issues like potholes, water leaks, or power outages, "
            "and AI automatically drafts official reports, assigns priority scores, routes to responsible authorities, and tracks real-time resolution status."
        )

    return (
        f"Regarding '{question}': I am your CivicFlow AI assistant! I can answer any question about science, technology, general knowledge, or civic issues. "
        f"If you're asking about your current grievance ({analysis.get('department', 'General')}), your report is being processed."
    )


@app.route("/assistant", methods=["POST"])
def assistant():
    data = request.get_json() or {}
    question = (data.get("question") or "").strip()
    context = data.get("context") or {}
    if not question:
        return jsonify({"error": "Question required"}), 400

    problem = context.get("problem") or question
    city = context.get("city") or ""
    analysis = first_pass(problem, city)

    answer = _answer_assistant_query(question, problem, city, context, analysis)

    return jsonify({
        "answer": answer,
        "analysis": validate_and_normalize(analysis, problem, city),
        "disclaimer": "CivicFlow does not place emergency calls unless you tap Call 112.",
    })


@app.route("/sla-config", methods=["GET"])
def sla_config():
    return jsonify({
        "minutes": SLA_MINUTES,
        "emergencyPhone": INDIA_EMERGENCY_NUMBER,
        "departments": list(DEPARTMENTS),
    })


@app.route("/demo-seed", methods=["GET"])
def demo_seed():
    return jsonify({"grievances": DEMO_GRIEVANCES, "isDemo": True})


@app.route("/request-password-reset", methods=["POST"])
def request_password_reset():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return jsonify({"error": "Valid email required"}), 400

    subject = "CivicFlow AI — Password Reset Confirmation & Instructions"
    body = f"""
Hello,

We received a password reset request for your CivicFlow AI citizen account ({email}).

Important Steps to Reset Your Password:
1. Firebase Authentication has dispatched a password reset link to this email address.
2. If you do not see the automated email in your Primary Inbox within a few minutes, PLEASE CHECK YOUR SPAM / JUNK / PROMOTIONS FOLDER.
3. If you registered your account using a dummy or different email, ensure you enter the exact email used during Citizen Registration.

If you did not request a password reset, you can safely disregard this email. Your CivicFlow AI account remains secure.

Thank you,
CivicFlow AI Support Team
"""
    try:
        if SENDER_EMAIL and SENDER_PASSWORD:
            send_email(email, subject, body)
            return jsonify({"status": "Password reset notification email dispatched via SMTP."})
        return jsonify({"status": "SMTP credentials not set, relying on standard Firebase Auth delivery."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------- SEND EMAIL ----------------
@app.route("/send-email", methods=["POST"])
def send_mail_api():
    try:
        body = request.form.get("body", "").strip()
        detailed_location = request.form.get("detailed_location", "").strip()
        latitude = request.form.get("latitude", "").strip()
        longitude = request.form.get("longitude", "").strip()
        attachments = request.files.getlist("image")

        if not body:
            return jsonify({"error": "Mail body missing"}), 400

        # ✅ Google Maps clickable link
        maps_link = ""
        if latitude and longitude:
            maps_link = f"https://www.google.com/maps?q={latitude},{longitude}"

        full_body = f"""
CIVIC GRIEVANCE REPORT

📍 Detailed Location:
{detailed_location if detailed_location else "Not provided"}

🧭 Coordinates:
Latitude: {latitude if latitude else "N/A"}
Longitude: {longitude if longitude else "N/A"}

🗺️ Open in Google Maps:
{maps_link if maps_link else "Location link not available"}

📝 Complaint:
{body}

-- Sent via CivicFlow AI (Gemini + local open-source first-pass)
"""

        send_email(
            AUTHORITY_EMAIL,
            "New Civic Grievance",
            full_body,
            attachments
        )

        return jsonify({"status": "Mail sent successfully"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---------------- HEALTH CHECK ----------------
@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "status": "CivicFlow AI backend running",
        "legacy": "GrievanceNet APIs preserved",
        "gemini": "google.generativeai",
        "localModel": "CivicHashNgram-128",
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "geminiConfigured": bool(os.getenv("GEMINI_API_KEY"))})

# ---------------- RUN ----------------
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
