package ai.civicflow.citizen

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

object ApiClient {
    private const val FIREBASE_API_KEY = "AIzaSyCDFUc8TFbhnSlL5l1wgocwWCE6xxN4yl8"
    private const val FIREBASE_PROJECT_ID = "civicflow-ai-b2144"
    private const val FIRESTORE_URL = "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/grievances"

    private const val FIREBASE_SIGNIN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$FIREBASE_API_KEY"
    private const val FIREBASE_SIGNUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$FIREBASE_API_KEY"

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .build()

    fun firebaseLogin(email: String, pass: String): Pair<Boolean, String> {
        return try {
            val payload = JSONObject().put("email", email).put("password", pass).put("returnSecureToken", true).toString().toRequestBody(jsonMedia)
            val req = Request.Builder().url(FIREBASE_SIGNIN_URL).post(payload).build()
            val resp = client.newCall(req).execute()
            val text = resp.body?.string() ?: ""
            val json = JSONObject(text)
            if (resp.isSuccessful && json.has("idToken")) {
                Pair(true, json.optString("email", email))
            } else {
                val err = json.optJSONObject("error")?.optString("message") ?: "Login failed"
                Pair(false, err)
            }
        } catch (e: Exception) {
            Pair(false, e.localizedMessage ?: "Connection error")
        }
    }

    fun firebaseRegister(email: String, pass: String): Pair<Boolean, String> {
        return try {
            val payload = JSONObject().put("email", email).put("password", pass).put("returnSecureToken", true).toString().toRequestBody(jsonMedia)
            val req = Request.Builder().url(FIREBASE_SIGNUP_URL).post(payload).build()
            val resp = client.newCall(req).execute()
            val text = resp.body?.string() ?: ""
            val json = JSONObject(text)
            if (resp.isSuccessful && json.has("idToken")) {
                Pair(true, json.optString("email", email))
            } else {
                val err = json.optJSONObject("error")?.optString("message") ?: "Registration failed"
                Pair(false, err)
            }
        } catch (e: Exception) {
            Pair(false, e.localizedMessage ?: "Connection error")
        }
    }

    fun requestPasswordReset(email: String): Pair<Boolean, String> {
        return try {
            val payload = JSONObject().put("email", email).toString().toRequestBody(jsonMedia)
            val req = Request.Builder().url("${BuildConfig.API_URL}/request-password-reset").post(payload).build()
            val resp = client.newCall(req).execute()
            val text = resp.body?.string() ?: ""
            val json = JSONObject(text)
            if (resp.isSuccessful) {
                Pair(true, json.optString("message", "Password reset email sent successfully!"))
            } else {
                Pair(false, json.optString("error", "Failed to send reset email."))
            }
        } catch (e: Exception) {
            Pair(false, e.localizedMessage ?: "Network error")
        }
    }

    fun saveToFirestore(item: JSONObject): String? {
        return try {
            val fields = JSONObject()
                .put("problem", JSONObject().put("stringValue", item.optString("problem", "")))
                .put("city", JSONObject().put("stringValue", item.optString("city", "")))
                .put("department", JSONObject().put("stringValue", item.optString("department", "General")))
                .put("category", JSONObject().put("stringValue", item.optString("category", "General")))
                .put("summary", JSONObject().put("stringValue", item.optString("summary", "")))
                .put("severity", JSONObject().put("stringValue", item.optString("severity", "Medium")))
                .put("priorityScore", JSONObject().put("integerValue", item.optInt("priorityScore", 50)))
                .put("priorityReason", JSONObject().put("stringValue", item.optString("priorityReason", "")))
                .put("routingReason", JSONObject().put("stringValue", item.optString("routingReason", "")))
                .put("status", JSONObject().put("stringValue", item.optString("status", "Submitted")))
                .put("emergency", JSONObject().put("booleanValue", item.optBoolean("emergency", false)))
                .put("emergencyReason", JSONObject().put("stringValue", item.optString("emergencyReason", "")))
                .put("detailedLocation", JSONObject().put("stringValue", item.optString("landmark", "")))
                .put("createdAtMillis", JSONObject().put("integerValue", System.currentTimeMillis()))

            val mail = item.optString("citizenEmail", "").trim().lowercase()
            if (mail.isNotBlank()) {
                fields.put("citizenEmail", JSONObject().put("stringValue", mail))
            }

            if (item.has("lat") && !item.isNull("lat")) {
                fields.put("latitude", JSONObject().put("doubleValue", item.optDouble("lat")))
            }
            if (item.has("lng") && !item.isNull("lng")) {
                fields.put("longitude", JSONObject().put("doubleValue", item.optDouble("lng")))
            }

            val docBody = JSONObject().put("fields", fields).toString().toRequestBody(jsonMedia)
            val req = Request.Builder().url(FIRESTORE_URL).post(docBody).build()
            val resp = client.newCall(req).execute()
            val text = resp.body?.string() ?: ""
            val json = JSONObject(text)
            val name = json.optString("name", "")
            if (name.isNotBlank()) name.substringAfterLast("/") else null
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    fun fetchFromFirestore(userEmail: String? = null): List<JSONObject> {
        val list = mutableListOf<JSONObject>()
        try {
            val req = Request.Builder().url(FIRESTORE_URL).get().build()
            val resp = client.newCall(req).execute()
            val text = resp.body?.string() ?: return list
            val json = JSONObject(text)
            val docs = json.optJSONArray("documents") ?: return list

            val mailFilter = userEmail?.trim()?.lowercase()

            for (i in 0 until docs.length()) {
                val docObj = docs.getJSONObject(i)
                val docName = docObj.optString("name", "")
                val id = docName.substringAfterLast("/")
                val fields = docObj.optJSONObject("fields") ?: continue

                val citizenEmail = (fields.optJSONObject("citizenEmail")?.optString("stringValue")
                    ?: fields.optJSONObject("email")?.optString("stringValue")
                    ?: fields.optJSONObject("userEmail")?.optString("stringValue")
                    ?: "").trim().lowercase()

                if (!mailFilter.isNullOrBlank() && citizenEmail.isNotBlank() && citizenEmail != mailFilter) {
                    continue // Skip grievances belonging to other users
                }

                val item = JSONObject()
                    .put("id", id)
                    .put("problem", fields.optJSONObject("problem")?.optString("stringValue", "") ?: "")
                    .put("city", fields.optJSONObject("city")?.optString("stringValue", "") ?: "")
                    .put("department", fields.optJSONObject("department")?.optString("stringValue", "General") ?: "General")
                    .put("category", fields.optJSONObject("category")?.optString("stringValue", "") ?: "")
                    .put("summary", fields.optJSONObject("summary")?.optString("stringValue", "") ?: "")
                    .put("severity", fields.optJSONObject("severity")?.optString("stringValue", "Medium") ?: "Medium")
                    .put("priorityScore", fields.optJSONObject("priorityScore")?.optString("integerValue", "50")?.toIntOrNull() ?: 50)
                    .put("status", fields.optJSONObject("status")?.optString("stringValue", "Submitted") ?: "Submitted")
                    .put("emergency", fields.optJSONObject("emergency")?.optBoolean("booleanValue", false) ?: false)
                    .put("emergencyReason", fields.optJSONObject("emergencyReason")?.optString("stringValue", "") ?: "")
                    .put("landmark", fields.optJSONObject("detailedLocation")?.optString("stringValue", "") ?: "")
                    .put("citizenEmail", citizenEmail)

                val latVal = fields.optJSONObject("latitude")?.optDouble("doubleValue")
                val lngVal = fields.optJSONObject("longitude")?.optDouble("doubleValue")
                if (latVal != null && !latVal.isNaN()) item.put("lat", latVal)
                if (lngVal != null && !lngVal.isNaN()) item.put("lng", lngVal)

                list.add(item)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return list
    }

    fun analyze(message: String, location: String, image: File? = null): JSONObject? {
        return try {
            val req = if (image != null) {
                val body = MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("message", message)
                    .addFormDataPart("location", location)
                    .addFormDataPart(
                        "image",
                        image.name,
                        image.asRequestBody("image/jpeg".toMediaType())
                    )
                    .build()
                Request.Builder().url("${BuildConfig.API_URL}/analyze").post(body).build()
            } else {
                val payload = JSONObject()
                    .put("message", message)
                    .put("location", location)
                    .toString()
                    .toRequestBody(jsonMedia)
                Request.Builder().url("${BuildConfig.API_URL}/analyze").post(payload).build()
            }
            val resp = client.newCall(req).execute()
            val text = resp.body?.string() ?: return null
            JSONObject(text)
        } catch (_: Exception) {
            null
        }
    }

    fun assistant(question: String, problem: String, city: String): String {
        return try {
            val payload = JSONObject()
                .put("question", question)
                .put("context", JSONObject().put("problem", problem).put("city", city))
                .toString()
                .toRequestBody(jsonMedia)
            val req = Request.Builder().url("${BuildConfig.API_URL}/assistant").post(payload).build()
            val resp = client.newCall(req).execute()
            JSONObject(resp.body?.string() ?: "{}").optString("answer", "Assistant unavailable.")
        } catch (_: Exception) {
            "Assistant offline. Local first-pass still works on this phone."
        }
    }

    fun officeKitPacket(grievance: JSONObject): JSONObject {
        return try {
            val payload = grievance.toString().toRequestBody(jsonMedia)
            val req = Request.Builder().url("${BuildConfig.API_URL}/office-kit/handoff").post(payload).build()
            val resp = client.newCall(req).execute()
            JSONObject(resp.body?.string() ?: "{}")
        } catch (_: Exception) {
            JSONObject()
                .put("type", "civicflow.officekit.v1")
                .put("product", "CivicFlow AI")
                .put("from", "phone-citizen-app")
                .put("to", "authority-command-center")
                .put("grievance", grievance)
                .put(
                    "note",
                    "Transfer this JSON to the laptop via iQOO Office Kit file share, clipboard, or mirroring. CivicFlow does not programmatically control Office Kit."
                )
        }
    }
}
