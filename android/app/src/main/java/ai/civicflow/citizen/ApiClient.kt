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

    val ADMIN_EMAILS = setOf(
        "admin@grievancenet.com",
        "admin@civicflow.ai",
        "authority@civicflow.ai",
        "siva@gmail.com"
    )

    var currentIdToken: String? = null
    var currentUid: String? = null
    var currentEmail: String? = null

    fun firebaseLogin(email: String, pass: String): Pair<Boolean, String> {
        return try {
            val payload = JSONObject().put("email", email).put("password", pass).put("returnSecureToken", true).toString().toRequestBody(jsonMedia)
            val req = Request.Builder().url(FIREBASE_SIGNIN_URL).post(payload).build()
            val resp = client.newCall(req).execute()
            val text = resp.body?.string() ?: ""
            val json = JSONObject(text)
            if (resp.isSuccessful && json.has("idToken")) {
                val uid = json.optString("localId", "")
                val tok = json.optString("idToken", "")
                val loggedEmail = json.optString("email", email).trim().lowercase()

                currentIdToken = tok
                currentUid = uid
                currentEmail = loggedEmail

                // Ensure user profile document exists in Firestore users/{uid}
                if (uid.isNotBlank()) {
                    try {
                        val userFields = JSONObject()
                            .put("email", JSONObject().put("stringValue", loggedEmail))
                            .put("role", JSONObject().put("stringValue", if (ADMIN_EMAILS.contains(loggedEmail)) "admin" else "citizen"))

                        val docBody = JSONObject().put("fields", userFields).toString().toRequestBody(jsonMedia)
                        val userReqBuilder = Request.Builder()
                            .url("https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/users/$uid")
                            .patch(docBody)
                        
                        if (tok.isNotBlank()) {
                            userReqBuilder.addHeader("Authorization", "Bearer $tok")
                        }
                        client.newCall(userReqBuilder.build()).execute()
                    } catch (_: Exception) {}
                }

                Pair(true, loggedEmail)
            } else {
                val err = json.optJSONObject("error")?.optString("message") ?: "Login failed"
                Pair(false, err)
            }
        } catch (e: Exception) {
            Pair(false, e.localizedMessage ?: "Connection error")
        }
    }

    fun firebaseAdminLogin(email: String, pass: String): Pair<Boolean, String> {
        val cleanEmail = email.trim().lowercase()
        if (!ADMIN_EMAILS.contains(cleanEmail)) {
            return Pair(false, "Access denied: '$cleanEmail' is not an authorized Admin email.")
        }
        val (ok, res) = firebaseLogin(cleanEmail, pass)
        if (ok) return Pair(true, res)

        val (regOk, regRes) = firebaseRegister("Authority Command Center Admin", "0000000000", cleanEmail, pass)
        if (regOk) return Pair(true, regRes)

        return Pair(false, res)
    }

    fun firebaseRegister(name: String, phone: String, email: String, pass: String): Pair<Boolean, String> {
        return try {
            val payload = JSONObject().put("email", email).put("password", pass).put("returnSecureToken", true).toString().toRequestBody(jsonMedia)
            val req = Request.Builder().url(FIREBASE_SIGNUP_URL).post(payload).build()
            val resp = client.newCall(req).execute()
            val text = resp.body?.string() ?: ""
            val json = JSONObject(text)
            if (resp.isSuccessful && json.has("idToken")) {
                val uid = json.optString("localId", "")
                val tok = json.optString("idToken", "")
                val registeredEmail = json.optString("email", email).trim().lowercase()

                currentIdToken = tok
                currentUid = uid
                currentEmail = registeredEmail

                if (uid.isNotBlank()) {
                    try {
                        val userFields = JSONObject()
                            .put("name", JSONObject().put("stringValue", name.trim().ifBlank { "Citizen User" }))
                            .put("email", JSONObject().put("stringValue", registeredEmail))
                            .put("phone", JSONObject().put("stringValue", phone.trim()))
                            .put("role", JSONObject().put("stringValue", if (ADMIN_EMAILS.contains(registeredEmail)) "admin" else "citizen"))

                        val docBody = JSONObject().put("fields", userFields).toString().toRequestBody(jsonMedia)
                        val userReqBuilder = Request.Builder()
                            .url("https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/users/$uid")
                            .patch(docBody)

                        if (tok.isNotBlank()) {
                            userReqBuilder.addHeader("Authorization", "Bearer $tok")
                        }

                        client.newCall(userReqBuilder.build()).execute()
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }

                Pair(true, registeredEmail)
            } else {
                val err = json.optJSONObject("error")?.optString("message") ?: "Registration failed"
                Pair(false, err)
            }
        } catch (e: Exception) {
            Pair(false, e.localizedMessage ?: "Connection error")
        }
    }

    fun firebaseRegister(email: String, pass: String): Pair<Boolean, String> {
        return firebaseRegister("Citizen User", "", email, pass)
    }

    fun requestPasswordReset(email: String): Pair<Boolean, String> {
        val cleanEmail = email.trim().lowercase()
        return try {
            val fbUrl = "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=$FIREBASE_API_KEY"
            val fbPayload = JSONObject().put("requestType", "PASSWORD_RESET").put("email", cleanEmail).toString().toRequestBody(jsonMedia)
            val fbReq = Request.Builder().url(fbUrl).post(fbPayload).build()
            val resp = client.newCall(fbReq).execute()
            val text = resp.body?.string() ?: ""
            val json = JSONObject(text)
            if (resp.isSuccessful) {
                Pair(true, "Password reset email sent! Please check your inbox and Spam folder.")
            } else {
                val errObj = json.optJSONObject("error")
                val msg = errObj?.optString("message", "User not found") ?: "User not found"
                if (msg.contains("EMAIL_NOT_FOUND", ignoreCase = true)) {
                    Pair(false, "No registered account found with email '$cleanEmail'.")
                } else {
                    Pair(false, "Failed to send reset link: $msg")
                }
            }
        } catch (e: Exception) {
            Pair(false, e.localizedMessage ?: "Network error during password reset")
        }
    }



    fun saveToFirestore(item: JSONObject): String? {
        return try {
            val mail = item.optString("citizenEmail", currentEmail ?: "").trim().lowercase()
            val uid = currentUid ?: ""

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
                .put("isDemo", JSONObject().put("booleanValue", false))

            if (uid.isNotBlank()) {
                fields.put("userId", JSONObject().put("stringValue", uid))
                fields.put("citizenId", JSONObject().put("stringValue", uid))
            }

            if (mail.isNotBlank()) {
                fields.put("citizenEmail", JSONObject().put("stringValue", mail))
                fields.put("userEmail", JSONObject().put("stringValue", mail))
                fields.put("email", JSONObject().put("stringValue", mail))
                fields.put("citizenName", JSONObject().put("stringValue", mail.substringBefore("@")))
            }

            if (item.has("lat") && !item.isNull("lat")) {
                fields.put("latitude", JSONObject().put("doubleValue", item.optDouble("lat")))
            }
            if (item.has("lng") && !item.isNull("lng")) {
                fields.put("longitude", JSONObject().put("doubleValue", item.optDouble("lng")))
            }

            val docBody = JSONObject().put("fields", fields).toString().toRequestBody(jsonMedia)
            val reqBuilder = Request.Builder().url(FIRESTORE_URL).post(docBody)
            currentIdToken?.let { tok ->
                if (tok.isNotBlank()) reqBuilder.addHeader("Authorization", "Bearer $tok")
            }

            val resp = client.newCall(reqBuilder.build()).execute()
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
            val reqBuilder = Request.Builder().url(FIRESTORE_URL).get()
            currentIdToken?.let { tok ->
                if (tok.isNotBlank()) reqBuilder.addHeader("Authorization", "Bearer $tok")
            }

            val resp = client.newCall(reqBuilder.build()).execute()
            val text = resp.body?.string() ?: return list
            val json = JSONObject(text)
            val docs = json.optJSONArray("documents") ?: return list

            val mailFilter = userEmail?.trim()?.lowercase() ?: ""

            for (i in 0 until docs.length()) {
                val docObj = docs.getJSONObject(i)
                val docName = docObj.optString("name", "")
                val id = docName.substringAfterLast("/")
                val fields = docObj.optJSONObject("fields") ?: continue

                val citizenEmail = (fields.optJSONObject("citizenEmail")?.optString("stringValue")
                    ?: fields.optJSONObject("email")?.optString("stringValue")
                    ?: fields.optJSONObject("userEmail")?.optString("stringValue")
                    ?: "").trim().lowercase()

                val userIdVal = (fields.optJSONObject("userId")?.optString("stringValue")
                    ?: fields.optJSONObject("citizenId")?.optString("stringValue")
                    ?: "").trim()

                if (mailFilter.isNotBlank()) {
                    val matchEmail = citizenEmail.isNotBlank() && citizenEmail == mailFilter
                    val matchUid = currentUid?.isNotBlank() == true && userIdVal == currentUid
                    if ((citizenEmail.isNotBlank() || userIdVal.isNotBlank()) && !matchEmail && !matchUid) {
                        continue // Skip grievances belonging to another user
                    }
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

    fun updateStatus(id: String, newStatus: String): Boolean {
        return try {
            val fields = JSONObject().put("status", JSONObject().put("stringValue", newStatus))
            val payload = JSONObject().put("fields", fields).toString().toRequestBody(jsonMedia)

            val reqBuilder = Request.Builder()
                .url("https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/grievances/$id?updateMask.fieldPaths=status")
                .patch(payload)

            currentIdToken?.let { tok ->
                if (tok.isNotBlank()) reqBuilder.addHeader("Authorization", "Bearer $tok")
            }

            val resp = client.newCall(reqBuilder.build()).execute()
            resp.isSuccessful
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun deleteGrievance(id: String): Boolean {

        return try {
            val reqBuilder = Request.Builder()
                .url("https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/grievances/$id")
                .delete()

            currentIdToken?.let { tok ->
                if (tok.isNotBlank()) reqBuilder.addHeader("Authorization", "Bearer $tok")
            }

            val resp = client.newCall(reqBuilder.build()).execute()
            resp.isSuccessful
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
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
