/** Browser fallback of the open CivicHash first-pass. Used if Flask is down. */

const DEPARTMENTS = ["Municipal", "Water", "Electricity", "Police", "Health", "General"];

function norm(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function any(text, phrases) {
  return phrases.some((p) => text.includes(p));
}

export function classifyLocal(problem, city = "") {
  const text = norm(problem);
  const scores = Object.fromEntries(DEPARTMENTS.map((d) => [d, 0]));
  let emergency = false;
  let emergencyReason = "No immediate threat to life or major public safety was indicated.";
  let category = "Unclassified civic issue";
  let severity = "Medium";
  let priority = 50;
  let routing = "Insufficient signal; defaulting toward general civic review.";
  let summary = (problem || "").slice(0, 240) || "Citizen civic report";

  const policeEm = any(text, [
    "attacking people", "attacking someone", "with a weapon", "armed assault",
    "stabbed", "stabbing", "knife", "gunshot", "firing", "shooting",
    "armed attack", "someone is attacking",
  ]);
  const healthEm = any(text, [
    "not responding", "unconscious", "not breathing", "isn't breathing",
    "isnt breathing", "heart attack", "collapsed and", "person collapsed", "severe bleeding",
  ]);
  const electricEm =
    (any(text, ["transformer"]) && any(text, ["spark", "smok", "explod", "fire", "burning"])) ||
    any(text, ["live wire", "live wires", "exposed wiring", "electrocution", "wires are live"]);
  const waterEm =
    (any(text, ["pipeline burst", "pipe burst", "main pipeline"]) && any(text, ["flood", "burst"])) ||
    (text.includes("flooding") && any(text, ["house", "home", "homes", "houses"]));
  const municipalEm = any(text, [
    "building has collapsed", "building collapsed", "building collapse",
    "wall has collapsed", "collapsed onto the road",
  ]);

  if (policeEm) {
    scores.Police += 12;
    emergency = true;
    category = "Armed Assault";
    severity = "Critical";
    priority = 98;
    routing = "Active violent crime requires police intervention.";
    emergencyReason = "Immediate threat to life from reported violence or a weapon.";
    summary = "Possible active violence or armed threat requiring urgent police action.";
  } else if (healthEm) {
    scores.Health += 12;
    emergency = true;
    category = "Medical Emergency";
    severity = "Critical";
    priority = 99;
    routing = "Severe medical risk requires health / EMS response.";
    emergencyReason = "A person appears unresponsive or in a life-threatening medical state.";
    summary = "Possible medical emergency involving an unresponsive person.";
  } else if (municipalEm) {
    scores.Municipal += 12;
    emergency = true;
    category = "Structural Collapse";
    severity = "Critical";
    priority = 97;
    routing = "Collapsed structures are a municipal public-safety emergency.";
    emergencyReason = "Building or structural collapse creates immediate public-safety danger.";
    summary = "Reported structural collapse with public-safety risk.";
  } else if (electricEm) {
    scores.Electricity += 12;
    emergency = true;
    category = "Electrical Hazard";
    severity = "Critical";
    priority = 96;
    routing = "Live electrical infrastructure requires the electricity authority.";
    emergencyReason = "Immediate electrical / fire risk, including sparking equipment or live wires.";
    summary = "Reported electrical fire or live-wire hazard.";
  } else if (waterEm) {
    scores.Water += 12;
    emergency = true;
    category = "Major Water Infrastructure Failure";
    severity = "Critical";
    priority = 95;
    routing = "Burst water infrastructure flooding homes is a Water department emergency.";
    emergencyReason = "Major pipeline failure with flooding of homes is an immediate safety risk.";
    summary = "Major water pipeline failure with flooding.";
  }

  if (any(text, ["pothole", "pot hole", "road crater", "broken road"])) {
    scores.Municipal += 8;
    if (!emergency) {
      category = "Road Maintenance";
      routing = "Road surface damage is a Municipal / roads responsibility.";
      summary = "Road damage / pothole report.";
      severity = text.includes("school") ? "High" : "Medium";
      priority = text.includes("school") ? 82 : 58;
    }
  }
  if (any(text, ["garbage", "trash", "waste piling", "dump"])) {
    scores.Municipal += 7;
    if (!emergency) {
      category = "Sanitation";
      routing = "Garbage accumulation is handled by Municipal sanitation.";
      summary = "Garbage / sanitation accumulation report.";
      const days = /\b\d+\s*day/.test(text) || text.includes("days");
      severity = days ? "High" : "Medium";
      priority = days ? 72 : 55;
    }
  }
  if (any(text, ["water leak", "no water", "contaminated water", "pipeline", "tap water"])) {
    scores.Water += 6;
  }
  if (any(text, ["streetlight", "street light", "street lamp", "lamp post"])) {
    scores.Electricity += 8;
    if (!emergency) {
      category = "Streetlight Failure";
      routing = "Streetlight maintenance falls under the electricity authority.";
      summary = "Non-functioning streetlight.";
      severity = "Medium";
      priority = 55;
      emergencyReason =
        "Reduced visibility is a civic safety concern, but no immediate electrical fire or live-wire hazard was reported.";
    }
  }
  if (any(text, ["power cut", "outage", "transformer", "electric", "wiring"])) {
    scores.Electricity += 4;
  }

  let department = DEPARTMENTS.reduce((a, b) => (scores[a] >= scores[b] ? a : b));
  if (scores[department] <= 0) {
    department = "General";
    if (!emergency) {
      category = "General civic issue";
      routing = "No department could be determined with high confidence.";
    }
  }
  if (emergency) {
    severity = "Critical";
    priority = Math.max(priority, 90);
  }
  const confidence = Math.min(0.97, 0.42 + Math.min(scores[department], 12) / 16);
  const loc = city ? ` Location context: ${city}.` : "";
  const priorityReason = emergency
    ? `${emergencyReason}${loc} Severity is ${severity} because of immediate public-safety risk.`
    : `${severity} priority for a ${department} issue based on reported impact without an immediate life-threatening emergency.${loc}`;

  return {
    department,
    category,
    summary,
    emergency,
    emergencyReason,
    severity,
    priorityScore: priority,
    priorityReason,
    routingReason: routing,
    confidence: Number(confidence.toFixed(2)),
    advice: emergency
      ? `This looks like an emergency routed to ${department}. Call 112 immediately if anyone is in danger. CivicFlow has not contacted emergency services.`
      : `This appears to be a ${department} civic grievance. Include a photo, precise landmark, and GPS.`,
    draftedMail: `To: ${
      department === "Electricity"
        ? "Executive Engineer / Assistant Engineer, Operations, Electricity Distribution Department"
        : department === "Municipal"
        ? "Municipal Commissioner / Executive Officer, Municipal Authority"
        : department === "Water"
        ? "Superintending Engineer / Executive Engineer, Water Supply & Sanitation Department"
        : department === "Police"
        ? "Station House Officer / Inspector of Police, Local Police Department"
        : department === "Health"
        ? "District Medical & Health Officer / Public Health Authority"
        : `${department} Authority`
    }
Subject: ${emergency ? "CRITICAL EMERGENCY: " : ""}${category} at ${city || "Reported Location"}

Respected Sir/Madam,

I am writing to report a hazardous civic issue requiring official intervention:

${problem}

Location: ${city || "Not specified"}
Urgency: ${emergency ? "Immediate / Critical" : "High / Standard Action Required"}

Yours faithfully,
Concerned Citizen`,
    mailTo: "",
    aiUsed: false,
    aiLayer: "local-open-source-browser",
    localModel: "CivicHashNgram-128 (browser fallback)",
    npuClaim: false,
    emergencyPhone: emergency ? "112" : null,
    immediateAction: emergency
      ? "Call emergency services now (112). Share your live location. CivicFlow has not contacted emergency services for you."
      : "Submit the grievance so the responsible department can act.",
  };
}
