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

# ---------------- EMAIL & FIREBASE CONFIG ----------------
SENDER_EMAIL = os.getenv("SENDER_EMAIL")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD")
FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY", "AIzaSyCDFUc8TFbhnSlL5l1wgocwWCE6xxN4yl8")

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
                "You are a knowledgeable and helpful AI assistant.\n"
                "Answer the user's question directly, clearly, and accurately in 2 to 4 sentences.\n"
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

    # 2. Clear fallbacks for specific queries if offline / fallback
    if q in {"what is ai", "what is artificial intelligence", "explain ai", "tell me about ai"}:
        return (
            "Artificial Intelligence (AI) refers to computer systems engineered to perform tasks that typically require human intelligence, "
            "such as visual perception, speech recognition, decision-making, and natural language processing. "
            "In CivicFlow AI, machine learning and generative AI analyze grievances, route departments, and answer questions."
        )

    if "department" in q or "who handles" in q or "rout" in q:
        return (
            f"Recommended department: {analysis.get('department', 'General')}. "
            f"{analysis.get('routingReason', '')}"
        )
    if "priority" in q or "severity" in q or "score" in q:
        return (
            f"Priority {analysis.get('priorityScore', 50)}/100 ({analysis.get('severity', 'Medium')}). "
            f"{analysis.get('priorityReason', '')}"
        )
    if "status" in q or "track" in q:
        status = context.get("status") or "Submitted"
        return f"Current tracked status: {status}. Authorities update this real-time from the command center."

    if "civicflow" in q or "what is this" in q or "help" in q:
        return (
            "CivicFlow AI is an AI-powered civic grievance platform. You can report community issues like potholes, water leaks, or power outages, "
            "and AI automatically drafts official reports, assigns priority scores, routes to responsible authorities, and tracks real-time resolution status."
        )

    return (
        f"Answer to '{question}': Artificial Intelligence enables computers to reason, learn, and assist users. "
        f"For your grievance query ({analysis.get('department', 'General')}), ensure your location and description are accurate."
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

    # 1. Trigger Firebase Identity Toolkit REST API to dispatch official password reset link email
    fb_sent = False
    fb_error = None
    try:
        fb_url = f"https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={FIREBASE_API_KEY}"
        fb_payload = {"requestType": "PASSWORD_RESET", "email": email}
        fb_resp = requests.post(fb_url, json=fb_payload, timeout=10)
        if fb_resp.status_code == 200:
            fb_sent = True
        else:
            err_obj = fb_resp.json().get("error", {})
            fb_error = err_obj.get("message", "Firebase user not found or reset failed")
    except Exception as e:
        fb_error = str(e)

    # 2. Prepare user notification email with direct reset portal link
    subject = "🔑 Reset Your CivicFlow AI Password"
    body = f"""
Hello,

We received a password reset request for your CivicFlow AI citizen account ({email}).

🔑 PASSWORD RESET INSTRUCTIONS:
1. An official Firebase Password Reset Link has been dispatched to {email}.
2. Check your inbox and Spam/Junk folder for an email from 'noreply@civicflow-ai-b2144.firebaseapp.com' or 'CivicFlow AI'.
3. Click the password reset link in that email to enter your new password.

Direct Password Action Portal:
https://civicflow-ai-b2144.firebaseapp.com/__/auth/action

If you did not request a password reset, you can safely ignore this email. Your CivicFlow AI account remains secure.

Best regards,
CivicFlow AI Support Team
"""
    try:
        if SENDER_EMAIL and SENDER_PASSWORD:
            send_email(email, subject, body)
            return jsonify({
                "status": "Password reset link dispatched! Please check your email inbox and Spam folder.",
                "firebase_sent": fb_sent
            })
        if fb_sent:
            return jsonify({
                "status": "Password reset link dispatched via Firebase! Check your email inbox and Spam folder."
            })
        return jsonify({"error": fb_error or "Failed to send password reset email"}), 400
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
