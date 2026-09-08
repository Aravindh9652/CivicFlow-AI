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
AUTHORITY_EMAIL = "grievancenet@gmail.com"

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
    data = request.get_json()
    user_message = data.get("message", "")
    city = data.get("location", "")

    prompt = f"""
Respond ONLY in valid JSON.
Do not add explanations or markdown.

{{
  "department": "Electricity / Water / Municipal / Police / Health",
  "summary": "short issue understanding",
  "advice": "next steps for citizen",
  "draftedMail": "formal grievance email"
}}

Complaint:
{user_message}

City:
{city}
"""

    try:
        model = genai.GenerativeModel(GEMINI_MODEL)
        response = model.generate_content(prompt)

        raw = response.text.strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        ai_json = json.loads(raw[start:end])

        ai_json["aiUsed"] = True
        ai_json["mailTo"] = AUTHORITY_EMAIL
        return jsonify(ai_json)

    except Exception:
        # -------- SAFE FALLBACK --------
        fallback = {
            "department": "General",
            "summary": "AI parsing fallback used",
            "advice": "Please review and send manually",
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
