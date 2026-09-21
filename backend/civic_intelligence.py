"""CivicFlow AI — controlled taxonomy, emergency, priority, and routing.

This module is deterministic. Gemini may enrich explanations, but it cannot
invent departments or skip validation.
"""

from __future__ import annotations

import os
import re
from typing import Any

DEPARTMENTS = (
    "Municipal",
    "Water",
    "Electricity",
    "Police",
    "Health",
    "General",
)

SEVERITIES = ("Critical", "High", "Medium", "Low")

INDIA_EMERGENCY_NUMBER = os.getenv("EMERGENCY_PHONE", "112")

SLA_MINUTES = {
    "Critical": int(os.getenv("SLA_CRITICAL_MINUTES", "15")),
    "High": int(os.getenv("SLA_HIGH_MINUTES", "120")),
    "Medium": int(os.getenv("SLA_MEDIUM_MINUTES", "1440")),
    "Low": int(os.getenv("SLA_LOW_MINUTES", "4320")),
}

AUTHORITY_EMAIL = os.getenv(
    "AUTHORITY_EMAIL", "civicflow.grievance.ai@gmail.com"
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _contains_any(text: str, phrases: tuple[str, ...]) -> bool:
    return any(p in text for p in phrases)


def classify_local(problem: str, city: str = "") -> dict[str, Any]:
    """On-device-capable first-pass civic classifier (rules + lexical scoring)."""
    raw = problem or ""
    text = _norm(raw)
    city = (city or "").strip()

    scores = {d: 0.0 for d in DEPARTMENTS}
    emergency = False
    emergency_reason = (
        "No immediate threat to life or major public safety was indicated."
    )
    category = "Unclassified civic issue"
    severity = "Medium"
    priority = 50
    routing = "Insufficient signal; defaulting toward general civic review."
    summary = raw.strip()[:240] or "Citizen civic report"

    # --- Emergency detectors (independent of department) ---
    police_emergency = _contains_any(
        text,
        (
            "attacking people",
            "attacking someone",
            "with a weapon",
            "armed assault",
            "stabbed",
            "stabbing",
            "knife",
            "gunshot",
            "firing",
            "shooting",
            "armed attack",
            "someone is attacking",
        ),
    )
    health_emergency = _contains_any(
        text,
        (
            "not responding",
            "unconscious",
            "not breathing",
            "isn't breathing",
            "isnt breathing",
            "heart attack",
            "collapsed and",
            "person collapsed",
            "severe bleeding",
        ),
    )
    electric_emergency = (
        _contains_any(text, ("transformer",))
        and _contains_any(text, ("spark", "smok", "explod", "fire", "burning"))
    ) or _contains_any(
        text,
        (
            "live wire",
            "live wires",
            "exposed wiring",
            "electrocution",
            "wires are live",
        ),
    )
    water_emergency = (
        _contains_any(text, ("pipeline burst", "pipe burst", "main pipeline"))
        and _contains_any(text, ("flood", "burst"))
    ) or (
        "flooding" in text
        and _contains_any(text, ("house", "home", "homes", "houses"))
    )
    municipal_emergency = _contains_any(
        text,
        (
            "building has collapsed",
            "building collapsed",
            "building collapse",
            "wall has collapsed",
            "collapsed onto the road",
        ),
    )

    if police_emergency:
        scores["Police"] += 12
        emergency = True
        category = "Armed Assault"
        severity = "Critical"
        priority = 98
        routing = "Active violent crime requires police intervention."
        emergency_reason = (
            "Immediate threat to life from reported violence or a weapon."
        )
        summary = "Possible active violence or armed threat requiring urgent police action."
    elif health_emergency:
        scores["Health"] += 12
        emergency = True
        category = "Medical Emergency"
        severity = "Critical"
        priority = 99
        routing = "Severe medical risk requires health / EMS response."
        emergency_reason = (
            "A person appears unresponsive or in a life-threatening medical state."
        )
        summary = "Possible medical emergency involving an unresponsive person."
    elif municipal_emergency:
        scores["Municipal"] += 12
        emergency = True
        category = "Structural Collapse"
        severity = "Critical"
        priority = 97
        routing = "Collapsed structures are a municipal public-safety emergency."
        emergency_reason = (
            "Building or structural collapse creates immediate public-safety danger."
        )
        summary = "Reported structural collapse with public-safety risk."
    elif electric_emergency:
        scores["Electricity"] += 12
        emergency = True
        category = "Electrical Hazard"
        severity = "Critical"
        priority = 96
        routing = "Live electrical infrastructure requires the electricity authority."
        emergency_reason = (
            "Immediate electrical / fire risk, including sparking equipment or live wires."
        )
        summary = "Reported electrical fire or live-wire hazard."
    elif water_emergency:
        scores["Water"] += 12
        emergency = True
        category = "Major Water Infrastructure Failure"
        severity = "Critical"
        priority = 95
        routing = "Burst water infrastructure flooding homes is a Water department emergency."
        emergency_reason = (
            "Major pipeline failure with flooding of homes is an immediate safety risk."
        )
        summary = "Major water pipeline failure with flooding."

    # --- Normal civic signals ---
    if _contains_any(text, ("pothole", "pot hole", "road crater", "broken road")):
        scores["Municipal"] += 8
        if not emergency:
            category = "Road Maintenance"
            routing = "Road surface damage is a Municipal / roads responsibility."
            summary = "Road damage / pothole report."
            severity = "High" if "school" in text else "Medium"
            priority = 82 if "school" in text else 58
            if "school" in text:
                emergency_reason = (
                    "No immediate life-threatening event was reported, but a pothole "
                    "near a school is a significant safety risk."
                )

    if _contains_any(text, ("garbage", "trash", "waste piling", "dump")):
        scores["Municipal"] += 7
        if not emergency:
            category = "Sanitation"
            routing = "Garbage accumulation is handled by Municipal sanitation."
            summary = "Garbage / sanitation accumulation report."
            days = bool(re.search(r"\b\d+\s*day", text)) or "days" in text
            severity = "High" if days else "Medium"
            priority = 72 if days else 55

    if _contains_any(text, ("drain", "sewage", "sewer", "sanitation")):
        scores["Municipal"] += 5

    if _contains_any(
        text, ("water leak", "no water", "contaminated water", "pipeline", "tap water")
    ):
        scores["Water"] += 6
        if not emergency and scores["Water"] >= scores["Municipal"]:
            category = "Water Supply"
            routing = "Water supply and pipeline issues route to the Water department."
            if "leak" in text:
                severity = "Medium"
                priority = 60
                summary = "Water leakage report."

    if _contains_any(text, ("streetlight", "street light", "street lamp", "lamp post")):
        scores["Electricity"] += 8
        if not emergency:
            category = "Streetlight Failure"
            routing = "Streetlight maintenance falls under the electricity authority."
            summary = "Non-functioning streetlight."
            severity = "Medium"
            priority = 55
            emergency_reason = (
                "Reduced visibility is a civic safety concern, but no immediate "
                "electrical fire or live-wire hazard was reported."
            )

    if _contains_any(text, ("power cut", "outage", "transformer", "electric", "wiring")):
        scores["Electricity"] += 4

    if _contains_any(text, ("theft", "stolen", "noise complaint", "lost item")):
        scores["Police"] += 4
        if not emergency:
            category = "Police Civic Complaint"
            routing = "Non-urgent police/civic matter."
            severity = "Medium"
            priority = 48

    if _contains_any(text, ("fever outbreak", "stagnant", "mosquito", "clinic")):
        scores["Health"] += 4
        if not emergency:
            category = "Public Health"
            routing = "Public-health complaints route to Health."
            severity = "Medium"
            priority = 52

    department = max(scores, key=scores.get)
    if scores[department] <= 0:
        department = "General"
        if not emergency:
            category = "General civic issue"
            routing = "No department could be determined with high confidence."
            severity = "Medium"
            priority = 50

    confidence = min(0.97, 0.42 + min(scores[department], 12) / 16)

    if emergency:
        severity = "Critical"
        priority = max(priority, 90)

    advice = _citizen_advice(department, emergency)
    drafted = _draft_mail(raw, city, department, category, emergency)

    return {
        "department": department,
        "category": category,
        "summary": summary,
        "emergency": emergency,
        "emergencyReason": emergency_reason,
        "severity": severity,
        "priorityScore": int(priority),
        "priorityReason": _priority_reason(
            department, severity, emergency, emergency_reason, city
        ),
        "routingReason": routing,
        "confidence": round(float(confidence), 2),
        "advice": advice,
        "draftedMail": drafted,
        "mailTo": AUTHORITY_EMAIL,
        "aiUsed": False,
        "aiLayer": "local-open-source",
        "emergencyPhone": INDIA_EMERGENCY_NUMBER if emergency else None,
        "immediateAction": (
            f"Call emergency services now ({INDIA_EMERGENCY_NUMBER}). "
            "Share your live location. CivicFlow has not contacted emergency "
            "services for you."
            if emergency
            else "Submit the grievance so the responsible department can act."
        ),
        "slaMinutes": SLA_MINUTES[severity],
    }


def _priority_reason(
    department: str,
    severity: str,
    emergency: bool,
    emergency_reason: str,
    city: str,
) -> str:
    loc = f" Location context: {city}." if city else ""
    if emergency:
        return f"{emergency_reason}{loc} Severity is {severity} because of immediate public-safety risk."
    return (
        f"{severity} priority for a {department} issue based on reported impact "
        f"without an immediate life-threatening emergency.{loc}"
    )


def _citizen_advice(department: str, emergency: bool) -> str:
    if emergency:
        return (
            f"This looks like an emergency routed to {department}. "
            f"Call {INDIA_EMERGENCY_NUMBER} immediately if anyone is in danger. "
            "CivicFlow does not dispatch police, fire, or ambulance by itself. "
            "Keep a safe distance, capture a photo only if it is safe, and share GPS."
        )
    return (
        f"This appears to be a {department} civic grievance. Include a photo, "
        "precise landmark, and GPS so authorities can verify and cluster related reports."
    )


def _draft_mail(
    problem: str, city: str, department: str, category: str, emergency: bool
) -> str:
    if department == "Electricity":
        dept_title = "Executive Engineer / Assistant Engineer, Operations, Electricity Distribution Department"
    elif department == "Municipal":
        dept_title = "Municipal Commissioner / Executive Officer, Municipal Authority"
    elif department == "Water":
        dept_title = "Superintending Engineer / Executive Engineer, Water Supply & Sanitation Department"
    elif department == "Police":
        dept_title = "Station House Officer / Inspector of Police, Local Police Department"
    elif department == "Health":
        dept_title = "District Medical & Health Officer / Public Health Authority"
    else:
        dept_title = f"{department} Authority"

    flag = "CRITICAL EMERGENCY: " if emergency else ""
    urgency = "Immediate / Critical" if emergency else "High / Standard Action Required"
    category_title = category if category else f"{department} Grievance"
    loc_str = f" at {city}" if city else ""

    p_clean = (problem or "").strip()
    if "I am writing" in p_clean or "Respected Sir" in p_clean:
        letter_body = p_clean
    elif emergency:
        letter_body = (
            f"I am writing to report a hazardous civic emergency requiring immediate intervention. {p_clean}\n\n"
            f"This situation presents an extreme risk to public safety and residents in the vicinity. "
            f"Please arrange for immediate emergency intervention and dispatch a field crew to secure the site."
        )
    else:
        letter_body = (
            f"I am writing to formally report a civic grievance requiring administrative intervention. {p_clean}\n\n"
            f"This situation poses significant inconvenience and public health/safety concerns to local residents. "
            f"Please inspect the specified location at the earliest and initiate necessary corrective measures to resolve this issue."
        )

    return f"""To: {dept_title}
Subject: {flag}{category_title}{loc_str}

Respected Sir/Madam,

{letter_body}

Location: {city or "Not specified"}
Urgency: {urgency}

Yours faithfully,
Concerned Citizen"""


def validate_and_normalize(payload: dict[str, Any], fallback_problem: str, city: str) -> dict[str, Any]:
    data = dict(payload or {})
    if data.get("department") not in DEPARTMENTS:
        data["department"] = "General"
    if data.get("severity") not in SEVERITIES:
        data["severity"] = "Medium"
    try:
        score = int(data.get("priorityScore", 50))
    except (TypeError, ValueError):
        score = 50
    data["priorityScore"] = max(0, min(100, score))
    try:
        conf = float(data.get("confidence", 0))
    except (TypeError, ValueError):
        conf = 0.0
    data["confidence"] = max(0.0, min(1.0, conf))
    emergency = data.get("emergency")
    if not isinstance(emergency, bool):
        emergency = False
    data["emergency"] = emergency
    if emergency:
        data["severity"] = "Critical"
        data["priorityScore"] = max(data["priorityScore"], 90)
        data["emergencyPhone"] = INDIA_EMERGENCY_NUMBER
    data.setdefault("category", "Unclassified civic issue")
    data.setdefault("summary", fallback_problem[:240])
    data.setdefault("priorityReason", "Priority derived from civic impact signals.")
    data.setdefault("routingReason", "Routed using the controlled department taxonomy.")
    data.setdefault("emergencyReason", "Emergency flag after validation.")
    data.setdefault("advice", _citizen_advice(data["department"], emergency))
    data.setdefault("draftedMail", _draft_mail(
        fallback_problem, city, data["department"], data["category"], emergency
    ))
    data["mailTo"] = AUTHORITY_EMAIL
    data["slaMinutes"] = SLA_MINUTES[data["severity"]]
    if "aiUsed" not in data:
        data["aiUsed"] = False
    return data


def merge_local_and_cloud(local: dict[str, Any], cloud: dict[str, Any] | None) -> dict[str, Any]:
    """Hybrid merge: local model is first-pass; Gemini may enrich, not override safety."""
    if not cloud:
        out = dict(local)
        out["aiUsed"] = False
        out["aiLayer"] = "local-open-source"
        return out

    merged = dict(cloud)
    # Safety-first emergency: local emergency wins if cloud missed it.
    if local.get("emergency") and not merged.get("emergency"):
        for key in (
            "emergency",
            "emergencyReason",
            "severity",
            "priorityScore",
            "department",
            "category",
            "immediateAction",
            "emergencyPhone",
        ):
            merged[key] = local.get(key)
        merged["priorityReason"] = local.get("priorityReason")
        merged["routingReason"] = local.get("routingReason")

    # Never invent a department.
    if merged.get("department") not in DEPARTMENTS:
        merged["department"] = local.get("department", "General")

    merged["aiUsed"] = True
    merged["aiLayer"] = "hybrid-local+gemini"
    merged["localDepartment"] = local.get("department")
    merged["localEmergency"] = local.get("emergency")
    merged["localPriorityScore"] = local.get("priorityScore")
    return validate_and_normalize(
        merged, local.get("summary") or "", ""
    )


def lexical_similarity(a: str, b: str) -> float:
    wa = set(re.findall(r"[a-z0-9]+", _norm(a)))
    wb = set(re.findall(r"[a-z0-9]+", _norm(b)))
    stop = {"the", "a", "an", "is", "near", "and", "of", "to", "in", "has", "been", "for"}
    wa -= stop
    wb -= stop
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def haversine_m(lat1, lon1, lat2, lon2) -> float | None:
    try:
        from math import radians, sin, cos, asin, sqrt

        lat1, lon1, lat2, lon2 = map(float, (lat1, lon1, lat2, lon2))
    except (TypeError, ValueError):
        return None
    r = 6371000
    p1, p2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    h = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * r * asin(sqrt(h))


def find_duplicates(candidate: dict[str, Any], existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    matches = []
    text = candidate.get("problem") or candidate.get("summary") or ""
    dept = candidate.get("department")
    lat = candidate.get("latitude")
    lng = candidate.get("longitude")
    for item in existing:
        if item.get("id") and candidate.get("id") and item["id"] == candidate["id"]:
            continue
        other_text = item.get("problem") or item.get("summary") or ""
        sim = lexical_similarity(text, other_text)
        try:
            from local_ai import cosine, hashed_ngram_embed

            embed_sim = cosine(hashed_ngram_embed(text), hashed_ngram_embed(other_text))
            sim = max(sim, embed_sim * 0.92)
        except Exception:
            pass
        dist = haversine_m(lat, lng, item.get("latitude"), item.get("longitude"))
        dept_bonus = 0.15 if dept and item.get("department") == dept else 0.0
        loc_bonus = 0.0
        if dist is not None and dist <= 250:
            loc_bonus = 0.25
        elif dist is not None and dist <= 800:
            loc_bonus = 0.12
        score = min(1.0, sim + dept_bonus + loc_bonus)
        if score >= 0.42:
            matches.append(
                {
                    "id": item.get("id"),
                    "problem": item.get("problem"),
                    "status": item.get("status"),
                    "department": item.get("department"),
                    "createdAt": item.get("createdAt"),
                    "distanceMeters": round(dist, 1) if dist is not None else None,
                    "similarity": round(score, 3),
                    "clusterId": item.get("clusterId"),
                }
            )
    matches.sort(key=lambda m: m["similarity"], reverse=True)
    return matches[:5]


def cluster_grievances(items: list[dict[str, Any]], radius_m: float = 450) -> list[dict[str, Any]]:
    clusters: list[dict[str, Any]] = []
    unused = [dict(g) for g in items if g.get("latitude") is not None and g.get("longitude") is not None]
    idx = 0
    while unused:
        seed = unused.pop(0)
        members = [seed]
        rest = []
        for other in unused:
            same_dept = (other.get("department") or "General") == (seed.get("department") or "General")
            d = haversine_m(
                seed.get("latitude"), seed.get("longitude"),
                other.get("latitude"), other.get("longitude"),
            )
            sim = lexical_similarity(seed.get("problem") or "", other.get("problem") or "")
            if d is not None and d <= radius_m and (same_dept or sim >= 0.35):
                members.append(other)
            else:
                rest.append(other)
        unused = rest
        idx += 1
        statuses = {}
        for m in members:
            st = m.get("status") or "Pending"
            statuses[st] = statuses.get(st, 0) + 1
        max_priority = max(int(m.get("priorityScore") or 0) for m in members)
        emergency = any(bool(m.get("emergency")) for m in members)
        dept = seed.get("department") or "General"
        clusters.append(
            {
                "clusterId": f"cluster-{idx}",
                "title": f"{dept} — {seed.get('category') or seed.get('problem', 'Civic issue')}",
                "department": dept,
                "latitude": seed.get("latitude"),
                "longitude": seed.get("longitude"),
                "locationHint": seed.get("city") or seed.get("detailedLocation") or "",
                "reports": len(members),
                "priority": "Critical" if emergency or max_priority >= 90 else (
                    "High" if max_priority >= 70 else "Medium" if max_priority >= 40 else "Low"
                ),
                "emergency": emergency,
                "statusCounts": statuses,
                "memberIds": [m.get("id") for m in members if m.get("id")],
            }
        )
    clusters.sort(key=lambda c: (not c["emergency"], -c["reports"]))
    return clusters


def insights_from_items(items: list[dict[str, Any]]) -> list[str]:
    if len(items) < 3:
        return ["Insufficient data for trend analysis."]
    notes = []
    n = len(items)
    by_dept: dict[str, int] = {}
    emergencies = 0
    pending = 0
    for g in items:
        d = g.get("department") or "General"
        by_dept[d] = by_dept.get(d, 0) + 1
        if g.get("emergency"):
            emergencies += 1
        if (g.get("status") or "Pending") in ("Pending", "In Progress"):
            pending += 1
    top_dept = max(by_dept, key=by_dept.get)
    notes.append(
        f"{top_dept} complaints represent {round(100 * by_dept[top_dept] / n)}% of the current set."
    )
    notes.append(f"{pending} of {n} grievances are still pending or in progress.")
    if emergencies:
        notes.append(f"{emergencies} reports are flagged as emergencies (any department).")
    clusters = cluster_grievances(items)
    hot = [c for c in clusters if c["reports"] >= 2]
    if hot:
        h = hot[0]
        notes.append(
            f"{h['reports']} grievances appear to describe the same underlying "
            f"{h['department']} issue near {h.get('locationHint') or 'the mapped area'}."
        )
    else:
        notes.append("No dense geographic clusters were detected in the current set.")

    elec_hot = len([c for c in clusters if c["department"] == "Electricity" and c["reports"] >= 2])
    if elec_hot:
        notes.append(f"Electricity complaints are concentrated in {elec_hot} mapped area(s).")
    water = by_dept.get("Water", 0)
    if water:
        notes.append(f"Water complaints are {round(100 * water / n)}% of this snapshot.")
    return notes
