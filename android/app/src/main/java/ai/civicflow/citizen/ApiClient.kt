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
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .build()

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
