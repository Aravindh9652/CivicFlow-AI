# CivicFlow AI

AI-Powered Civic Grievance Intelligence & Emergency Response Platform.

Built for **iQOO Hackathon 2026 — Hyderabad City Battle (Battle 04)** under the **Open Innovation Track**.

CivicFlow AI turns a citizen's phone into an intelligent civic sensor. By combining multimodal intake (voice dictation, camera evidence, GPS pin-drop) with an on-device/local first-pass classifier (`CivicHashNgram-128`) and Cloud Gemini Flash reasoning, CivicFlow AI automatically routes grievances to the responsible authority, calculates priority scores (0–100), detects 112 emergency hazards, clusters 450m geographic hotspots, and provides a real-time Command Center for city officials.

## Architecture

```
iQOO PHONE (Kotlin + Compose)
  Camera / Voice / GPS / On-Device CivicHashNgram-128 Engine
        │ HTTPS
        ▼
Flask Backend (Gemini Flash + Local AI Classifier)
        │
   Firebase Auth / Firestore / Storage
        │
Laptop WEB — Authority Command Center (React.js + Leaflet Maps)
```

Hybrid AI Pipeline: **On-Device / Local First-Pass Classifier ➔ Civic Intelligence Rules ➔ Gemini Flash Reasoning**.

## Key Features

- **📱 Multimodal Citizen Intake**: Text, Speech-to-Text voice dictation, camera photo evidence compression, and 1-tap GPS geolocation.
- **⚡ Zero-Latency Local Classifier**: On-device `CivicHashNgram-128` model for instant offline department routing and priority scoring.
- **🚨 112 Emergency Protocol**: Auto-detects critical hazards (sparking transformers, structural collapse, armed violence) and enables direct 112 emergency calling.
- **⭕ 450m Spatial Hotspot Clustering**: Grouping multiple reports within 450 meters into unified departmental incident clusters.
- **🔍 Duplicate Incident Suppression**: Cosine similarity text matching links duplicate complaints to prevent authority backlog.
- **🛡️ Authority Command Center**: Triaged action queues, real-time SLA countdown timers, and automated city-wide executive AI insights reports.
- **📱 Phone-to-Laptop Office Kit Integration**: Export civic report payloads (`civicflow.officekit.v1`) for seamless phone-to-laptop mirroring and clipboard transfer.

## Run Locally

### Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.template .env
# fill GEMINI_API_KEY, SENDER_EMAIL, SENDER_PASSWORD
python app.py
```

### Frontend:

```powershell
cd frontend
copy .env.example .env
# fill REACT_APP_FIREBASE_* and REACT_APP_API_URL
npm install
npm start
```

### Scenario Tests:

```powershell
cd backend
python test_civic_scenarios.py
```

### Production Build:

```powershell
cd frontend
npm run build
```

### Android App:

1. Open the `android/` folder in Android Studio.
2. Configure the API endpoint (`http://10.0.2.2:5000` or production backend URL).
3. Build & run on your iQOO flagship phone.

## Deploy

1. Deploy Flask backend to Render / Cloud Run with environment secrets.
2. Rebuild frontend with production `REACT_APP_API_URL`.
3. `firebase deploy --only hosting,firestore:rules,storage`

## 3-Minute Hackathon Demo

1. **Phone Intake**: Capture camera evidence + voice transcript + GPS on a civic problem or emergency.
2. **On-Device AI**: Instant department classification, severity score, and priority rationale.
3. **Hotspot & Duplicate Suppression**: Detects duplicate reports or clusters nearby incidents within 450m.
4. **Office Kit Bridge**: Export `civicflow.officekit.v1` JSON payload to the laptop Command Center via screen mirror/clipboard.
5. **Authority Command Center**: View Critical queue, SLA countdowns, interactive Leaflet maps, and executive AI insights.
6. **112 Emergency**: Direct 112 one-tap call for active public safety hazards.

## Pitch (30s)

CivicFlow AI turns a citizen’s phone into a civic incident sensor. Camera, voice and GPS become a structured, routed, prioritized issue. Local open-source AI runs first on the phone; Gemini deepens reasoning in the cloud. Authorities see clusters and SLA — not a pile of emails.

## Office Kit Integration

CivicFlow AI exports `civicflow.officekit.v1` JSON payloads. Transfer reports effortlessly using iQOO Office Kit file sharing, screen mirroring, or shared clipboard to inspect on the Command Center **Office** tab.

## Team & Hackathon

Built by **TeamGaneshaa** (Vajja Aravindh, Vatsavai Venkatasai Devavarshita, Makka Siva) for **iQOO Hackathon 2026 (Hyderabad Battle 04)**.
