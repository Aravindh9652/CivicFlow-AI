# CivicFlow AI

AI-powered civic intelligence and emergency response platform.

CivicFlow AI is an **enhanced evolution** of the pre-existing [Google-GrievanceNet](https://github.com/Aravindh9652/Google-GrievanceNet) foundation (deployed visual reference: [gemini-greivancenet.web.app](https://gemini-greivancenet.web.app/)). The original React + Flask + Firebase + Gemini grievance flow is preserved. For the iQOO Hackathon 2026 Hyderabad City Battle (Open Innovation), we add multimodal intake, hybrid local/open-source + Gemini intelligence, emergency escalation, duplicates, clustering, SLA, and a Kotlin/Compose citizen app.

> Do not claim the entire product was created during the hackathon. The foundation existed; CivicFlow AI is the intelligence and phone-first layer.

## Architecture

```
iQOO PHONE (Kotlin + Compose)
  Camera / Mic / GPS / local CivicHashNgram-128
        │ HTTPS
        ▼
Flask (google.generativeai Gemini + local first-pass)
        │
   Firebase Auth / Firestore / Storage
        │
Laptop WEB — Authority Command Center (React, GrievanceNet visual language)
```

Hybrid AI: **on-device/local first-pass → CivicFlow rules → Gemini when available**. Gemini is never removed. Snapdragon NPU is **not** claimed on this CPU build; the encoder is NPU-portable later via ONNX.

## Run locally

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.template .env
# fill GEMINI_API_KEY, SENDER_EMAIL, SENDER_PASSWORD
python app.py
```

Frontend:

```powershell
cd frontend
copy .env.example .env
# fill REACT_APP_FIREBASE_* and REACT_APP_API_URL
npm install
npm start
```

Scenario tests:

```powershell
cd backend
python test_civic_scenarios.py
```

Production web build:

```powershell
cd frontend
npm run build
```

Android (requires Android Studio + SDK; this machine may not have them):

1. Open the `android/` folder in Android Studio.
2. Point the Flask API at `http://10.0.2.2:5000` (emulator) or your LAN IP.
3. Run on the iQOO phone.

## Deploy

1. Deploy Flask (Cloud Run / App Service) with env secrets — never commit `.env`.
2. Set `REACT_APP_API_URL` to that origin and rebuild the frontend.
3. `firebase deploy --only hosting,firestore:rules,storage`

Admin email for Firestore status updates: `admin@grievancenet.com` (see `firestore.rules`).

## What existed before the hackathon

Google-GrievanceNet: React login/register, Flask `/chat` + `/send-email`, Firebase Auth/Firestore/Storage, Gemini (`google.generativeai`), Leaflet maps, email drafts, citizen dashboard.

## Local / open-source model

**CivicHashNgram-128** — hashed character n-gram encoder (128-d) plus a deterministic civic classifier, ported to Kotlin (`LocalCivicModel.kt` / `CivicClassifier.kt`) and Python (`local_ai.py` / `civic_intelligence.py`). Optional `CIVICFLOW_ONNX_MODEL` hook for MiniLM/Gemma ONNX on CPU. **This build does not execute Snapdragon NPU inference.**

## 3-minute demo

1. Phone: camera + voice + GPS on a pothole or spoken emergency.
2. Local AI: department, emergency vs normal, priority with a reason.
3. Duplicate / cluster if similar reports exist.
4. Share JSON via Office Kit to the laptop Command Center.
5. Laptop: Critical queue, hotspot map, SLA, insights (demo seed tagged `isDemo`).
6. Emergency: Call 112 — never claim a dispatch.

## Pitch (30s)

CivicFlow AI turns a citizen’s phone into a civic incident sensor. Camera, voice and GPS become a structured, routed, prioritized issue. Local open-source AI runs first on the phone; Gemini deepens reasoning in the cloud. Authorities see clusters and SLA — not a pile of emails.

## Office Kit (honest)

CivicFlow does not remote-control iQOO Office Kit. The phone **Share** action exports `civicflow.officekit.v1` JSON. Transfer it with Office Kit file share, clipboard, or screen mirroring, then paste it on the Command Center **office** tab.
