from flask import Flask, request, jsonify
from flask_cors import CORS
import os, json, smtplib
from email.message import EmailMessage
from dotenv import load_dotenv
import google.generativeai as genai

# ---------------- SETUP ----------------
load_dotenv()

app = Flask(__name__)
CORS(app)

# ---------------- GEMINI CONFIG ----------------
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
GEMINI_MODEL = "models/gemini-flash-latest"

# ---------------- EMAIL CONFIG ----------------
SENDER_EMAIL = os.getenv("SENDER_EMAIL")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD")

# Same email for all departments (hackathon demo)
AUTHORITY_EMAIL = "civicflow.grievance.ai@gmail.com"

# ---------------- EMAIL HELPER ----------------
def send_email(to_email, subject, body, attachments=None):
    msg = EmailMessage()
    msg["From"] = SENDER_EMAIL
    msg["To"] = to_email
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

    prompt = f"""
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
- advice should prioritize immediate safe action

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

    try:
        # EXISTING GEMINI INTEGRATION — intentionally preserved
        model = genai.GenerativeModel(GEMINI_MODEL)
        response = model.generate_content(prompt)

        raw = response.text.strip()

        start = raw.find("{")
        end = raw.rfind("}") + 1

        if start == -1 or end <= start:
            raise ValueError("Gemini did not return valid JSON")

        ai_json = json.loads(raw[start:end])

        # ---------------- VALIDATION ----------------
        allowed_departments = {
            "Municipal",
            "Water",
            "Electricity",
            "Police",
            "Health",
            "General"
        }

        allowed_severity = {
            "Critical",
            "High",
            "Medium",
            "Low"
        }

        department = ai_json.get("department")
        severity = ai_json.get("severity")
        priority_score = ai_json.get("priorityScore")
        confidence = ai_json.get("confidence")
        emergency = ai_json.get("emergency")

        if department not in allowed_departments:
            raise ValueError("Invalid department returned by AI")

        if severity not in allowed_severity:
            raise ValueError("Invalid severity returned by AI")

        if not isinstance(priority_score, int) or not 0 <= priority_score <= 100:
            raise ValueError("Invalid priority score returned by AI")

        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise ValueError("Invalid confidence returned by AI")

        if not isinstance(emergency, bool):
            raise ValueError("Invalid emergency flag returned by AI")

        # Emergency consistency validation
        if emergency and severity != "Critical":
            raise ValueError(
                "Emergency grievance must have Critical severity"
            )

        # Preserve existing fields and add new CivicFlow intelligence.
        ai_json["aiUsed"] = True
        ai_json["mailTo"] = AUTHORITY_EMAIL

        return jsonify(ai_json)

    except Exception:
        # -------- SAFE FALLBACK --------
        fallback = {
            # Existing fields
            "department": "General",
            "summary": "AI analysis could not be validated. Manual review required.",
            "advice": "Please review the grievance and route it manually.",
            "draftedMail": f"""
To,
The Concerned Authority

Subject: Civic grievance

Respected Sir/Madam,

I would like to report the following issue:

{user_message}

Location: {city}

Kindly take necessary action.

Thanking you.

Yours sincerely,
A concerned citizen
""",

            # Structured intelligence
            "category": "Unclassified civic issue",

            "emergency": False,
            "emergencyReason": (
                "Emergency status could not be safely determined. "
                "Manual review is required."
            ),

            "severity": "Medium",
            "priorityScore": 50,
            "priorityReason": (
                "AI analysis could not be validated, so manual review "
                "is required."
            ),

            "routingReason": (
                "Department could not be safely determined automatically."
            ),

            "confidence": 0.0,

            "aiUsed": False,
            "mailTo": AUTHORITY_EMAIL
        }

        return jsonify(fallback), 200

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

-- Sent via GrievanceNet (Gemini-powered)
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
    return jsonify({"status": "GrievanceNet backend running"})

# ---------------- RUN ----------------
if __name__ == "__main__":
    app.run(debug=True)
