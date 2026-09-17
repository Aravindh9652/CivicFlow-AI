package ai.civicflow.citizen

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.UUID

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFF667EEA))) {
                Surface(Modifier.fillMaxSize()) { CivicNav() }
            }
        }
    }
}

private val Navy = Color(0xFF0A0E27)
private val CardBg = Color(0x1AFFFFFF)

data class SavedComplaint(
    val id: String,
    val problem: String,
    val analysis: CivicAnalysis,
    val lat: Double?,
    val lng: Double?,
    val status: String = "Pending"
)

@Composable
fun CivicNav() {
    val nav = rememberNavController()
    val ctx = LocalContext.current
    val complaints = remember { mutableStateListOf<SavedComplaint>() }
    var problem by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var analysis by remember { mutableStateOf<CivicAnalysis?>(null) }
    var lat by remember { mutableStateOf<Double?>(null) }
    var lng by remember { mutableStateOf<Double?>(null) }
    var landmark by remember { mutableStateOf("") }
    var photoPath by remember { mutableStateOf<String?>(null) }
    var photoBmp by remember { mutableStateOf<Bitmap?>(null) }
    var selectedId by remember { mutableStateOf<String?>(null) }

    val bg = Brush.verticalGradient(listOf(Navy, Color(0xFF151932), Color(0xFF1A1030)))
    Column(Modifier.fillMaxSize().background(bg)) {
        NavHost(nav, startDestination = "splash") {
            composable("splash") { ScreenScaffold {
                Text("CivicFlow AI", style = MaterialTheme.typography.headlineMedium)
                Text("From citizen complaints to coordinated civic action.")
                Spacer(Modifier.height(24.dp))
                Button(onClick = { nav.navigate("login") }) { Text("Continue") }
            } }
            composable("login") { ScreenScaffold {
                Text("🔐 Welcome Back")
                Text("This phone session is the citizen intake. Authority login stays on the laptop Command Center (Firebase).")
                var email by remember { mutableStateOf("") }
                OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("Email (on-device label)") })
                Button(onClick = { nav.navigate("home") }) { Text("Enter citizen app") }
            } }
            composable("home") { ScreenScaffold {
                Text("Citizen home")
                Button(onClick = { nav.navigate("raise") }) { Text("Raise complaint") }
                Button(onClick = { nav.navigate("mine") }) { Text("My complaints") }
                Button(onClick = { nav.navigate("assistant") }) { Text("AI assistant") }
            } }
            composable("raise") {
                RaiseScreen(
                    problem, { problem = it },
                    city, { city = it },
                    onAnalyzed = { analysis = it; nav.navigate("result") },
                    onCamera = { nav.navigate("camera") },
                    onVoice = { nav.navigate("voice") },
                    onGps = { nav.navigate("gps") },
                    photoBmp = photoBmp,
                    photoPath = photoPath
                )
            }
            composable("camera") {
                val ctx = LocalContext.current
                var permissionGranted by remember {
                    mutableStateOf(
                        ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                    )
                }

                var tempPhotoFile by remember { mutableStateOf<File?>(null) }
                var tempPhotoUri by remember { mutableStateOf<Uri?>(null) }

                fun createTempFile(): Pair<File, Uri> {
                    val file = File(ctx.cacheDir, "civic_evidence_${System.currentTimeMillis()}.jpg")
                    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
                    return Pair(file, uri)
                }

                fun processAndSetImage(file: File?, fallbackBmp: Bitmap?) {
                    val targetFile = file ?: File(ctx.cacheDir, "civic_evidence_${System.currentTimeMillis()}.jpg")
                    val (compressedBmp, path) = compressAndSavePhoto(ctx, fallbackBmp, targetFile)
                    if (compressedBmp != null && path != null) {
                        photoBmp = compressedBmp
                        photoPath = path
                        Toast.makeText(ctx, "📷 Evidence captured and compressed successfully!", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(ctx, "Failed to capture image", Toast.LENGTH_SHORT).show()
                    }
                }

                val fullPhotoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
                    if (success && tempPhotoFile != null) {
                        processAndSetImage(tempPhotoFile, null)
                    }
                }

                val previewPhotoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp ->
                    if (bmp != null) {
                        val file = File(ctx.cacheDir, "civic_evidence_${System.currentTimeMillis()}.jpg")
                        processAndSetImage(file, bmp)
                    }
                }

                val cameraPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
                    permissionGranted = isGranted
                    if (isGranted) {
                        try {
                            val (f, u) = createTempFile()
                            tempPhotoFile = f
                            tempPhotoUri = u
                            fullPhotoLauncher.launch(u)
                        } catch (_: Exception) {
                            previewPhotoLauncher.launch(null)
                        }
                    } else {
                        Toast.makeText(ctx, "Camera permission is required to capture evidence", Toast.LENGTH_LONG).show()
                    }
                }

                fun launchCameraFlow() {
                    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        permissionGranted = true
                        try {
                            val (f, u) = createTempFile()
                            tempPhotoFile = f
                            tempPhotoUri = u
                            fullPhotoLauncher.launch(u)
                        } catch (_: Exception) {
                            previewPhotoLauncher.launch(null)
                        }
                    } else {
                        cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                    }
                }

                ScreenScaffold {
                    Text("📸 Camera Evidence Intake", style = MaterialTheme.typography.titleLarge)
                    Text("Capture clear photo evidence of potholes, water leaks, garbage, or structural hazards. The compressed photo is sent directly to the AI analysis pipeline.")

                    if (photoBmp != null && photoPath != null) {
                        val fileSizeKb = (File(photoPath!!).length() / 1024).toInt()
                        Card(
                            colors = CardDefaults.cardColors(CardBg),
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
                        ) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("✅ Evidence Attached (${fileSizeKb} KB compressed)", style = MaterialTheme.typography.bodyMedium)
                                Image(
                                    bitmap = photoBmp!!.asImageBitmap(),
                                    contentDescription = "Civic evidence photo",
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(240.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .border(1.dp, Color(0x40667EEA), RoundedCornerShape(12.dp))
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(
                                        onClick = { launchCameraFlow() },
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Text("📷 Retake Photo")
                                    }
                                    Button(
                                        onClick = {
                                            photoBmp = null
                                            photoPath = null
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0x33EF4444)),
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Text("🗑️ Remove", color = Color(0xFFFCA5A5))
                                    }
                                }
                            }
                        }
                    } else {
                        Card(
                            colors = CardDefaults.cardColors(CardBg),
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
                        ) {
                            Column(
                                Modifier.padding(24.dp).fillMaxWidth(),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Text("No image attached yet")
                                Button(onClick = { launchCameraFlow() }) {
                                    Text("📷 Open Camera")
                                }
                            }
                        }
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(
                            onClick = { nav.navigate("raise") },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Done — Back to Complaint")
                        }
                    }
                }
            }
            composable("voice") {
                val ctx = LocalContext.current
                val speech = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
                    val spoken = res.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
                    if (!spoken.isNullOrBlank()) problem = spoken
                    nav.popBackStack()
                }
                ScreenScaffold {
                    Text("Voice recording")
                    Text("Speak the grievance. The transcript is editable before analysis.")
                    Button(onClick = {
                        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
                        }
                        speech.launch(intent)
                    }) { Text("Start microphone") }
                    TextButton(onClick = { nav.popBackStack() }) { Text("Back") }
                }
            }
            composable("gps") {
                val ctx = LocalContext.current
                val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
                    if (granted.values.any { it } &&
                        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    ) {
                        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
                        val loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                            ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                        if (loc != null) {
                            lat = loc.latitude
                            lng = loc.longitude
                            try {
                                val geo = Geocoder(ctx, Locale.getDefault())
                                    .getFromLocation(loc.latitude, loc.longitude, 1)
                                landmark = geo?.firstOrNull()?.getAddressLine(0) ?: landmark
                                if (city.isBlank()) city = geo?.firstOrNull()?.locality ?: city
                            } catch (_: Exception) { }
                        }
                    }
                }
                ScreenScaffold {
                    Text("GPS")
                    Text(if (lat != null) "Lat $lat  Lng $lng" else "Location not captured yet.")
                    Text(landmark)
                    Button(onClick = {
                        perm.launch(arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        ))
                    }) { Text("Capture GPS") }
                    TextButton(onClick = { nav.popBackStack() }) { Text("Back") }
                }
            }
            composable("result") {
                ResultScreen(
                    problem, city, analysis,
                    lat, lng, landmark,
                    onSave = {
                        val a = analysis ?: return@ResultScreen
                        val id = UUID.randomUUID().toString()
                        complaints.add(0, SavedComplaint(id, problem, a, lat, lng))
                        NotificationHelper.statusSaved(
                            ctx,
                            "CivicFlow grievance saved",
                            "${a.department} · ${a.severity}. Status updates appear on the laptop Command Center."
                        )
                        nav.navigate("mine")
                    },
                    onBack = { nav.popBackStack() }
                )
            }
            composable("mine") { ScreenScaffold {
                Text("My complaints")
                if (complaints.isEmpty()) Text("No grievances on this phone yet.")
                complaints.forEach { c ->
                    Card(
                        Modifier.fillMaxWidth().padding(vertical = 6.dp).clickable {
                            selectedId = c.id; nav.navigate("details")
                        },
                        colors = CardDefaults.cardColors(CardBg),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Text(c.problem)
                            Text("${c.analysis.department} · ${c.analysis.severity} · ${c.status}")
                            if (c.analysis.emergency) Text("EMERGENCY — call 112. CivicFlow did not dispatch help.")
                        }
                    }
                }
                TextButton(onClick = { nav.navigate("home") }) { Text("Home") }
            } }
            composable("details") {
                val c = complaints.find { it.id == selectedId }
                ScreenScaffold {
                    Text("Complaint details")
                    if (c == null) Text("Not found")
                    else {
                        Text(c.problem)
                        Text("${c.analysis.department} · ${c.analysis.severity} · score ${c.analysis.priorityScore}")
                        Text(c.analysis.priorityReason)
                        Text("Status: ${c.status}")
                        if (c.analysis.emergency) Text("Call 112 — CivicFlow did not dispatch help.")
                    }
                    TextButton(onClick = { nav.popBackStack() }) { Text("Back") }
                }
            }
            composable("assistant") {
                var q by remember { mutableStateOf("") }
                var a by remember { mutableStateOf("") }
                val scope = rememberCoroutineScope()
                ScreenScaffold {
                    Text("Citizen AI assistant")
                    OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth(), label = { Text("Question") })
                    Button(onClick = {
                        scope.launch {
                            a = withContext(Dispatchers.IO) {
                                ApiClient.assistant(q, problem.ifBlank { q }, city)
                            }
                        }
                    }) { Text("Ask") }
                    Text(a)
                    TextButton(onClick = { nav.popBackStack() }) { Text("Back") }
                }
            }
        }
    }
}

@Composable
private fun ScreenScaffold(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(20.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) { content() }
}

private fun compressAndSavePhoto(ctx: Context, inputBitmap: Bitmap?, file: File): Pair<Bitmap?, String?> {
    try {
        val srcBmp = inputBitmap ?: if (file.exists()) BitmapFactory.decodeFile(file.absolutePath) else null
        if (srcBmp == null) return Pair(null, null)

        val maxDim = 1280
        val scale = minOf(1f, maxDim.toFloat() / maxOf(srcBmp.width, srcBmp.height))
        val scaledW = (srcBmp.width * scale).toInt().coerceAtLeast(1)
        val scaledH = (srcBmp.height * scale).toInt().coerceAtLeast(1)

        val scaledBmp = if (scale < 1f) {
            Bitmap.createScaledBitmap(srcBmp, scaledW, scaledH, true)
        } else {
            srcBmp
        }

        FileOutputStream(file).use { out ->
            scaledBmp.compress(Bitmap.CompressFormat.JPEG, 82, out)
        }
        return Pair(scaledBmp, file.absolutePath)
    } catch (e: Exception) {
        e.printStackTrace()
        return Pair(inputBitmap, file.takeIf { it.exists() }?.absolutePath)
    }
}

@Composable
private fun RaiseScreen(
    problem: String,
    onProblem: (String) -> Unit,
    city: String,
    onCity: (String) -> Unit,
    onAnalyzed: (CivicAnalysis) -> Unit,
    onCamera: () -> Unit,
    onVoice: () -> Unit,
    onGps: () -> Unit,
    photoBmp: Bitmap?,
    photoPath: String?
) {
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(false) }
    ScreenScaffold {
        Text("📢 Raise Civic Grievance", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(problem, onProblem, Modifier.fillMaxWidth(), label = { Text("Describe the issue (e.g. pothole, sewage, burst pipe)") }, minLines = 4)
        OutlinedTextField(city, onCity, Modifier.fillMaxWidth(), label = { Text("City / Area (e.g. Vijayawada, MG Road)") })

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(onClick = onCamera, modifier = Modifier.weight(1f)) {
                Text(if (photoBmp != null) "📷 Change Photo" else "📷 Camera")
            }
            Button(onClick = onVoice, modifier = Modifier.weight(1f)) { Text("🎙️ Voice") }
            Button(onClick = onGps, modifier = Modifier.weight(1f)) { Text("📍 GPS") }
        }

        if (photoBmp != null) {
            val sizeKb = photoPath?.let { File(it) }?.takeIf { it.exists() }?.length()?.div(1024) ?: 0
            Card(
                colors = CardDefaults.cardColors(CardBg),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("📷 Evidence Attached (${sizeKb} KB compressed)", style = MaterialTheme.typography.bodySmall, color = Color(0xFFA0AEC0))
                        TextButton(onClick = onCamera) { Text("Retake", style = MaterialTheme.typography.labelSmall) }
                    }
                    Image(
                        bitmap = photoBmp.asImageBitmap(),
                        contentDescription = "Evidence preview",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .border(1.dp, Color(0x40667EEA), RoundedCornerShape(12.dp))
                    )
                }
            }
        }

        Button(onClick = {
            loading = true
            scope.launch {
                val local = CivicClassifier.classify(problem, city)
                val imageFile = photoPath?.let { File(it) }?.takeIf { it.exists() }
                val cloud = withContext(Dispatchers.IO) { ApiClient.analyze(problem, city, imageFile) }
                val merged = if (cloud != null && cloud.has("department")) {
                    local.copy(
                        department = cloud.optString("department", local.department),
                        category = cloud.optString("category", local.category),
                        summary = cloud.optString("summary", local.summary),
                        emergency = cloud.optBoolean("emergency", local.emergency) || local.emergency,
                        emergencyReason = cloud.optString("emergencyReason", local.emergencyReason),
                        severity = if (local.emergency) "Critical" else cloud.optString("severity", local.severity),
                        priorityScore = maxOf(local.priorityScore, cloud.optInt("priorityScore", local.priorityScore)),
                        priorityReason = cloud.optString("priorityReason", local.priorityReason),
                        routingReason = cloud.optString("routingReason", local.routingReason),
                        confidence = cloud.optDouble("confidence", local.confidence),
                        advice = cloud.optString("advice", local.advice),
                        draftedMail = cloud.optString("draftedMail", local.draftedMail)
                    )
                } else local
                loading = false
                onAnalyzed(merged)
            }
        }, enabled = problem.isNotBlank() && !loading, modifier = Modifier.fillMaxWidth()) {
            if (loading) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.width(18.dp).height(18.dp), strokeWidth = 2.dp, color = Color.White)
                    Text(if (photoBmp != null) "Analyzing image & text with AI..." else "Analyzing with AI...")
                }
            } else {
                Text(if (photoBmp != null) "Analyze Issue + Image Evidence" else "Analyze Grievance")
            }
        }
        Text("AI classifies department, severity, priority, and emergency status directly from text + photo.", style = MaterialTheme.typography.bodySmall, color = Color(0xFFA0AEC0))
    }
}

@Composable
private fun ResultScreen(
    problem: String,
    city: String,
    analysis: CivicAnalysis?,
    lat: Double?,
    lng: Double?,
    landmark: String,
    onSave: () -> Unit,
    onBack: () -> Unit
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val a = analysis ?: return
    ScreenScaffold {
        Text("AI analysis")
        Text("${a.department}  ·  ${a.severity}  ·  ${a.priorityScore}")
        if (a.emergency) {
            Text("🚨 EMERGENCY DETECTED")
            Text(a.emergencyReason)
            Text(a.immediateAction)
            Button(onClick = {
                ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:112")))
            }) { Text("CALL 112") }
        }
        Text("Why department: ${a.routingReason}")
        Text("Why priority: ${a.priorityReason}")
        Text("Confidence: ${(a.confidence * 100).toInt()}%")
        Text("Local model: ${a.localModel}")
        Text("NPU claimed: ${a.npuClaim} (this build runs CPU first-pass)")
        if (lat != null) Text("GPS $lat, $lng")
        if (landmark.isNotBlank()) Text(landmark)
        Button(onClick = onSave) { Text("Save / track on phone") }
        Button(onClick = {
            scope.launch {
                val packet = withContext(Dispatchers.IO) {
                    ApiClient.officeKitPacket(
                        JSONObject()
                            .put("problem", problem)
                            .put("city", city)
                            .put("department", a.department)
                            .put("severity", a.severity)
                            .put("priorityScore", a.priorityScore)
                            .put("emergency", a.emergency)
                            .put("latitude", lat)
                            .put("longitude", lng)
                            .put("landmark", landmark)
                    )
                }
                ctx.startActivity(Intent.createChooser(OfficeKitHandoff.shareIntent(packet), "Office Kit transfer"))
            }
        }) { Text("Share to laptop (Office Kit)") }
        TextButton(onClick = onBack) { Text("Back") }
    }
}
