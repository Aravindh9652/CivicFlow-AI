package ai.civicflow.citizen

/**
 * Deterministic first-pass civic classifier — port of backend/civic_intelligence.py.
 * Emergency is independent of department.
 */
data class CivicAnalysis(
    val department: String,
    val category: String,
    val summary: String,
    val emergency: Boolean,
    val emergencyReason: String,
    val severity: String,
    val priorityScore: Int,
    val priorityReason: String,
    val routingReason: String,
    val confidence: Double,
    val advice: String,
    val draftedMail: String,
    val localModel: String = LocalCivicModel.NAME,
    val npuClaim: Boolean = false,
    val emergencyPhone: String? = if (emergency) "112" else null,
    val immediateAction: String = if (emergency) {
        "Call emergency services now (112). Share your live location. CivicFlow has not contacted emergency services for you."
    } else {
        "Submit the grievance so the responsible department can act."
    }
)

object CivicClassifier {
    private val departments = listOf("Municipal", "Water", "Electricity", "Police", "Health", "General")

    fun classify(problem: String, city: String = ""): CivicAnalysis {
        val text = problem.lowercase().replace(Regex("\\s+"), " ").trim()
        val scores = departments.associateWith { 0.0 }.toMutableMap()
        var emergency = false
        var emergencyReason = "No immediate threat to life or major public safety was indicated."
        var category = "Unclassified civic issue"
        var severity = "Medium"
        var priority = 50
        var routing = "Insufficient signal; defaulting toward general civic review."
        var summary = problem.take(240).ifBlank { "Citizen civic report" }

        fun any(vararg p: String) = p.any { text.contains(it) }

        val policeEm = any(
            "attacking people", "attacking someone", "with a weapon", "armed assault",
            "stabbed", "stabbing", "knife", "gunshot", "firing", "shooting",
            "armed attack", "someone is attacking"
        )
        val healthEm = any(
            "not responding", "unconscious", "not breathing", "isn't breathing",
            "isnt breathing", "heart attack", "collapsed and", "person collapsed", "severe bleeding"
        )
        val electricEm = (any("transformer") && any("spark", "smok", "explod", "fire", "burning")) ||
            any("live wire", "live wires", "exposed wiring", "electrocution", "wires are live")
        val waterEm = (any("pipeline burst", "pipe burst", "main pipeline") && any("flood", "burst")) ||
            (text.contains("flooding") && any("house", "home", "homes", "houses"))
        val municipalEm = any(
            "building has collapsed", "building collapsed", "building collapse",
            "wall has collapsed", "collapsed onto the road"
        )

        when {
            policeEm -> {
                scores["Police"] = scores["Police"]!! + 12
                emergency = true
                category = "Armed Assault"
                severity = "Critical"
                priority = 98
                routing = "Active violent crime requires police intervention."
                emergencyReason = "Immediate threat to life from reported violence or a weapon."
                summary = "Possible active violence or armed threat requiring urgent police action."
            }
            healthEm -> {
                scores["Health"] = scores["Health"]!! + 12
                emergency = true
                category = "Medical Emergency"
                severity = "Critical"
                priority = 99
                routing = "Severe medical risk requires health / EMS response."
                emergencyReason = "A person appears unresponsive or in a life-threatening medical state."
                summary = "Possible medical emergency involving an unresponsive person."
            }
            municipalEm -> {
                scores["Municipal"] = scores["Municipal"]!! + 12
                emergency = true
                category = "Structural Collapse"
                severity = "Critical"
                priority = 97
                routing = "Collapsed structures are a municipal public-safety emergency."
                emergencyReason = "Building or structural collapse creates immediate public-safety danger."
                summary = "Reported structural collapse with public-safety risk."
            }
            electricEm -> {
                scores["Electricity"] = scores["Electricity"]!! + 12
                emergency = true
                category = "Electrical Hazard"
                severity = "Critical"
                priority = 96
                routing = "Live electrical infrastructure requires the electricity authority."
                emergencyReason = "Immediate electrical / fire risk, including sparking equipment or live wires."
                summary = "Reported electrical fire or live-wire hazard."
            }
            waterEm -> {
                scores["Water"] = scores["Water"]!! + 12
                emergency = true
                category = "Major Water Infrastructure Failure"
                severity = "Critical"
                priority = 95
                routing = "Burst water infrastructure flooding homes is a Water department emergency."
                emergencyReason = "Major pipeline failure with flooding of homes is an immediate safety risk."
                summary = "Major water pipeline failure with flooding."
            }
        }

        if (any("pothole", "pot hole", "road crater", "broken road")) {
            scores["Municipal"] = scores["Municipal"]!! + 8
            if (!emergency) {
                category = "Road Maintenance"
                routing = "Road surface damage is a Municipal / roads responsibility."
                summary = "Road damage / pothole report."
                severity = if (text.contains("school")) "High" else "Medium"
                priority = if (text.contains("school")) 82 else 58
            }
        }
        if (any("garbage", "trash", "waste piling", "dump")) {
            scores["Municipal"] = scores["Municipal"]!! + 7
            if (!emergency) {
                category = "Sanitation"
                routing = "Garbage accumulation is handled by Municipal sanitation."
                summary = "Garbage / sanitation accumulation report."
                val days = Regex("\\b\\d+\\s*day").containsMatchIn(text) || text.contains("days")
                severity = if (days) "High" else "Medium"
                priority = if (days) 72 else 55
            }
        }
        if (any("water leak", "no water", "contaminated water", "pipeline", "tap water")) {
            scores["Water"] = scores["Water"]!! + 6
        }
        if (any("streetlight", "street light", "street lamp", "lamp post")) {
            scores["Electricity"] = scores["Electricity"]!! + 8
            if (!emergency) {
                category = "Streetlight Failure"
                routing = "Streetlight maintenance falls under the electricity authority."
                summary = "Non-functioning streetlight."
                severity = "Medium"
                priority = 55
                emergencyReason = "Reduced visibility is a civic safety concern, but no immediate electrical fire or live-wire hazard was reported."
            }
        }
        if (any("power cut", "outage", "transformer", "electric", "wiring")) {
            scores["Electricity"] = scores["Electricity"]!! + 4
        }

        var department = scores.maxBy { it.value }.key
        if (scores[department]!! <= 0.0) {
            department = "General"
            if (!emergency) {
                category = "General civic issue"
                routing = "No department could be determined with high confidence."
            }
        }
        if (emergency) {
            severity = "Critical"
            priority = maxOf(priority, 90)
        }
        val confidence = (0.42 + minOf(scores[department] ?: 0.0, 12.0) / 16).coerceAtMost(0.97)
        val loc = if (city.isNotBlank()) " Location context: $city." else ""
        val priorityReason = if (emergency) {
            "$emergencyReason$loc Severity is $severity because of immediate public-safety risk."
        } else {
            "$severity priority for a $department issue based on reported impact without an immediate life-threatening emergency.$loc"
        }
        val advice = if (emergency) {
            "This looks like an emergency routed to $department. Call 112 immediately if anyone is in danger. CivicFlow does not dispatch police, fire, or ambulance by itself."
        } else {
            "This appears to be a $department civic grievance. Include a photo, precise landmark, and GPS."
        }
        val drafted = """
To,
The $department Authority

Subject: ${if (emergency) "EMERGENCY — " else ""}Civic grievance — $category

I would like to report:
$problem

Location / area: ${city.ifBlank { "Not specified" }}

Kindly inspect and take necessary action. For emergencies, call 112; this email is supporting evidence.

Yours sincerely,
A concerned citizen
        """.trimIndent()

        LocalCivicModel.embed("$problem $city")
        return CivicAnalysis(
            department = department,
            category = category,
            summary = summary,
            emergency = emergency,
            emergencyReason = emergencyReason,
            severity = severity,
            priorityScore = priority,
            priorityReason = priorityReason,
            routingReason = routing,
            confidence = confidence,
            advice = advice,
            draftedMail = drafted
        )
    }
}
