import { auth, db, storage } from "./firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import "./App.css";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  orderBy,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { API_URL, ADMIN_EMAILS, SLA_DEFAULT } from "./lib/config";
import { slaDeadlineFrom, slaState } from "./lib/sla";
import { classifyLocal } from "./lib/localClassify";
import Starfield from "./Starfield";

function badgeClass(severity, emergency) {
  if (emergency) return "badge badge-emergency";
  if (severity === "Critical") return "badge badge-critical";
  if (severity === "High") return "badge badge-high";
  if (severity === "Low") return "badge badge-low";
  return "badge badge-medium";
}

async function compressImage(file) {
  if (!file || !file.type?.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const max = 1280;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

const STATUS_STEPS = ["Submitted", "Under Review", "Assigned", "In Progress", "Resolved"];

export default function App() {
  const [page, setPage] = useState(0);

  const [problem, setProblem] = useState("");
  const [city, setCity] = useState("");
  const [aiData, setAiData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [coords, setCoords] = useState(null);
  const [detailedLocation, setDetailedLocation] = useState("");
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [mailBody, setMailBody] = useState("");

  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [authMode, setAuthMode] = useState("login"); // 'login' | 'register' | 'admin'
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  const [grievances, setGrievances] = useState([]);
  const [allGrievances, setAllGrievances] = useState([]);
  const [corpus, setCorpus] = useState([]);
  const [selectedGrievanceId, setSelectedGrievanceId] = useState(null);

  const selectedGrievance = useMemo(() => {
    if (!selectedGrievanceId) return null;
    return (
      grievances.find((g) => g.id === selectedGrievanceId) ||
      allGrievances.find((g) => g.id === selectedGrievanceId) ||
      null
    );
  }, [selectedGrievanceId, grievances, allGrievances]);

  const [isAdmin, setIsAdmin] = useState(false);
  const [listening, setListening] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [assistantQ, setAssistantQ] = useState("");
  const [assistantA, setAssistantA] = useState("");
  const [adminTab, setAdminTab] = useState("queue");
  const [mapFilter, setMapFilter] = useState("All");
  const [handoffText, setHandoffText] = useState("");
  const [slaMinutes, setSlaMinutes] = useState(SLA_DEFAULT);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setPage(0);
      }

      const mail = currentUser?.email?.toLowerCase() || "";
      setIsAdmin(!!currentUser && ADMIN_EMAILS.includes(mail));
    });

    return () => unsubscribe();
  }, []);

  // Citizen real-time grievances listener
  useEffect(() => {
    if (!user) {
      setGrievances([]);
      return;
    }

    const mail = user.email?.toLowerCase() || "";
    const q = query(collection(db, "grievances"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs
          .map((d) => ({
            id: d.id,
            ...d.data(),
          }))
          .filter(
            (g) =>
              g.userId === user.uid ||
              g.citizenId === user.uid ||
              (mail && g.citizenEmail?.toLowerCase() === mail)
          );
        list.sort((a, b) => {
          const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
          const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
          return tb - ta;
        });
        setGrievances(list);
      },
      (err) => {
        console.warn("User grievances listener notice:", err);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Admin real-time snapshot listener
  useEffect(() => {
    if (!isAdmin) return;

    const q = query(
      collection(db, "grievances"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setAllGrievances(
          snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        );
      },
      (err) => {
        console.warn("Admin query snapshot notice:", err);
      }
    );

    return () => unsubscribe();
  }, [isAdmin]);

  // Corpus for duplicate checking
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "grievances"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setCorpus(
          snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        );
      },
      () => setCorpus([])
    );
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    fetch(`${API_URL}/sla-config`)
      .then((r) => r.json())
      .then((d) => d?.minutes && setSlaMinutes(d.minutes))
      .catch(() => {});
  }, []);

  const login = async () => {
    if (!email || !password) {
      setAuthError("Email and password are required");
      return;
    }

    const mailClean = email.trim().toLowerCase();
    if (!mailClean.includes("@")) {
      setAuthError("Please enter a valid email address");
      return;
    }

    if (authMode === "admin" && !ADMIN_EMAILS.includes(mailClean)) {
      setAuthError("Access denied: Email is not on the authorized Admin whitelist.");
      return;
    }

    try {
      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, mailClean, password);
      } catch (err) {
        // If signing in as admin and account doesn't exist in Firebase Auth yet, auto-initialize whitelisted admin account
        if (authMode === "admin" && ADMIN_EMAILS.includes(mailClean)) {
          cred = await createUserWithEmailAndPassword(auth, mailClean, password);
          await setDoc(doc(db, "users", cred.user.uid), {
            name: "Authority Command Center Admin",
            email: mailClean,
            role: "admin",
            createdAt: serverTimestamp(),
          });
        } else {
          throw err;
        }
      }

      setAuthError("");
      if (authMode === "admin") {
        const loggedMail = cred.user?.email?.toLowerCase() || "";
        if (!ADMIN_EMAILS.includes(loggedMail)) {
          await signOut(auth);
          setAuthError("Access denied: Not an authorized authority admin account.");
          return;
        }
      }
    } catch (err) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        setAuthError("Invalid email or password. Please check your credentials.");
      } else {
        setAuthError(err.message || "Authentication error occurred.");
      }
    }
  };

  const updateStatus = async (id, newStatus) => {
    try {
      await updateDoc(doc(db, "grievances", id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      alert("Failed to update status");
    }
  };

  const register = async () => {
    if (!email || !password || !name || !phone.trim()) {
      setAuthError("All fields are required (Name, Email, Phone Number, Password)");
      return;
    }

    if (!email.includes("@")) {
      setAuthError("Please enter a valid email address");
      return;
    }

    if (phone.trim().length < 7) {
      setAuthError("Please enter a valid Phone Number (at least 7 digits)");
      return;
    }

    if (password.length < 6) {
      setAuthError("Password must be at least 6 characters");
      return;
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const uid = cred.user.uid;

      // Save user record to users/{uid} with strict role="citizen"
      await setDoc(doc(db, "users", uid), {
        name,
        email: email.trim(),
        phone: phone.trim(),
        role: "citizen",
        createdAt: serverTimestamp(),
      });

      await signOut(auth);

      setEmail("");
      setPassword("");
      setName("");
      setPhone("");

      setAuthMode("login");
      setAuthError("✅ Account registered successfully! Please log in.");
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setPage(0);
    setProblem("");
    setAiData(null);
    setMailBody("");
    setCoords(null);
    setDetailedLocation("");
    setDuplicates([]);
    setSelectedGrievanceId(null);
    setAuthError("");
  };

  // eslint-disable-next-line no-unused-vars
  const generateMail = async () => {
    if (!problem.trim()) {
      alert("Please describe your problem first");
      return;
    }

    setLoading(true);
    setAiData(null);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: problem, location: city }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiData(data);
      setMailBody(data.draftedMail || "");
    } catch {
      const local = classifyLocal(problem, city);
      setAiData(local);
      setMailBody(local.draftedMail || "");
    }

    setLoading(false);
  };

  const analyzeMultimodal = async () => {
    if (!problem.trim()) {
      alert("Please describe your problem first");
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      form.append("message", problem);
      form.append("location", city);
      if (image) form.append("image", image);
      const res = await fetch(`${API_URL}/analyze`, { method: "POST", body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiData(data);
      setMailBody(data.draftedMail || "");
    } catch {
      const local = classifyLocal(problem, city);
      setAiData(local);
      setMailBody(local.draftedMail || "");
    }
    setLoading(false);
  };

  const getCurrentLocation = () => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setCoords(next);
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${next.lat}&lon=${next.lng}`,
            { headers: { Accept: "application/json" } }
          );
          const geo = await r.json();
          if (geo?.display_name) {
            setDetailedLocation((prev) => prev || geo.display_name);
            setCity((prev) => prev || geo.address?.city || geo.address?.town || geo.address?.state || "");
          }
        } catch {
          /* reverse geocode fallback to coords */
        }
      },
      () => alert("Location permission denied")
    );
  };

  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input is not supported in this browser. Use Chrome/Edge or the Android app.");
      return;
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.onresult = (ev) => {
      const text = Array.from(ev.results).map((r) => r[0].transcript).join(" ");
      setProblem(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const onPickImage = async (file) => {
    const compressed = await compressImage(file);
    setImage(compressed);
    setImagePreview(compressed ? URL.createObjectURL(compressed) : "");
  };

  const checkDuplicates = async (payload) => {
    try {
      const existing = (corpus.length ? corpus : isAdmin ? allGrievances : grievances).map((g) => ({
        id: g.id,
        problem: g.problem,
        summary: g.summary,
        department: g.department,
        latitude: g.latitude,
        longitude: g.longitude,
        status: g.status,
        createdAt: g.createdAt?.toDate ? g.createdAt.toDate().toISOString() : null,
        clusterId: g.clusterId || null,
      }));
      const res = await fetch(`${API_URL}/duplicates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate: payload,
          existing,
        }),
      });
      const data = await res.json();
      setDuplicates(data.matches || []);
      return data.matches || [];
    } catch {
      setDuplicates([]);
      return [];
    }
  };

  const persistGrievance = async ({ emailSent }) => {
    let photoUrl = "";
    if (image && storage) {
      try {
        const storageRef = ref(storage, `grievances/${user.uid}/${Date.now()}.jpg`);
        await uploadBytes(storageRef, image);
        photoUrl = await getDownloadURL(storageRef);
      } catch (err) {
        console.warn("Storage upload skipped", err);
      }
    }

    const slaMins = slaMinutes[aiData?.severity] || SLA_DEFAULT.Medium;
    await addDoc(collection(db, "grievances"), {
      userId: user.uid,
      citizenId: user.uid,
      citizenEmail: user.email || "",
      citizenName: name || user.displayName || user.email?.split("@")[0] || "Citizen",

      problem,
      city,
      detailedLocation,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,

      department: aiData?.department ?? "General",
      category: aiData?.category ?? "Uncategorized",
      summary: aiData?.summary ?? problem,

      severity: aiData?.severity ?? "Medium",
      priorityScore: aiData?.priorityScore ?? 50,
      priorityReason: aiData?.priorityReason ?? "",
      routingReason: aiData?.routingReason ?? "",
      confidence: aiData?.confidence ?? 0,

      emergency: aiData?.emergency ?? false,
      emergencyReason: aiData?.emergencyReason ?? "",

      photoUrl: photoUrl || "",
      imageUrl: photoUrl || "",

      duplicateOf: duplicates[0]?.id || null,
      duplicateScore: duplicates[0]?.similarity || null,
      clusterId: duplicates[0]?.clusterId || null,

      status: "Submitted",
      slaMinutes: slaMins,
      slaDeadlineMs: Date.now() + slaMins * 60 * 1000,
      slaStatus: "on_track",

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      aiUsed: aiData?.aiUsed ?? false,
      aiLayer: aiData?.aiLayer || "local-open-source",
      mailBody,
      emailSent,
      isDemo: false,
    });
  };

  const sendEmail = async () => {
    const payload = {
      problem,
      summary: aiData?.summary,
      department: aiData?.department,
      latitude: coords?.lat,
      longitude: coords?.lng,
    };
    await checkDuplicates(payload);

    try {
      const formData = new FormData();
      formData.append("body", mailBody);
      formData.append("detailed_location", detailedLocation);
      formData.append("latitude", coords?.lat || "");
      formData.append("longitude", coords?.lng || "");
      if (image) formData.append("image", image);

      const res = await fetch(`${API_URL}/send-email`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      const emailSent = res.ok;
      await persistGrievance({ emailSent });

      if (emailSent) {
        alert("✅ Grievance submitted and notification email sent successfully!");
      } else {
        alert(
          `Grievance saved to CivicFlow AI. (${data.error || "mail notify bypassed"}).`
        );
      }
      setPage(3);
    } catch (err) {
      console.error(err);
      try {
        await persistGrievance({ emailSent: false });
        alert("Grievance saved successfully to CivicFlow AI!");
        setPage(3);
      } catch {
        alert("❌ Error submitting grievance");
      }
    }
  };

  const seedDemo = async () => {
    try {
      const res = await fetch(`${API_URL}/demo-seed`);
      const data = await res.json();
      for (const g of data.grievances || []) {
        await addDoc(collection(db, "grievances"), {
          ...g,
          userId: user.uid,
          citizenId: user.uid,
          mailBody: g.summary,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          slaMinutes: slaMinutes[g.severity] || 1440,
          slaDeadlineMs: Date.now() + (slaMinutes[g.severity] || 1440) * 60 * 1000,
          aiUsed: false,
          aiLayer: "demo-seed",
          isDemo: true,
        });
      }
      alert("Demo sample grievances added. They are tagged isDemo=true.");
    } catch {
      alert("Could not seed demo data. Is the Flask backend running?");
    }
  };

  const askAssistant = async () => {
    if (!assistantQ.trim()) return;
    try {
      const res = await fetch(`${API_URL}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: assistantQ,
          context: { problem, city, status: grievances[0]?.status },
        }),
      });
      const data = await res.json();
      setAssistantA(data.answer || data.error);
    } catch {
      setAssistantA("Assistant is offline. You can still submit a grievance.");
    }
  };

  const clusters = useMemo(() => {
    const items = allGrievances.filter((g) => g.latitude != null && g.longitude != null);
    const used = new Set();
    const out = [];
    items.forEach((g, i) => {
      if (used.has(g.id)) return;
      const members = [g];
      items.forEach((o) => {
        if (o.id === g.id || used.has(o.id)) return;
        const same = (o.department || "") === (g.department || "");
        const dlat = Number(o.latitude) - Number(g.latitude);
        const dlng = Number(o.longitude) - Number(g.longitude);
        const approxM = Math.sqrt(dlat * dlat + dlng * dlng) * 111000;
        if (same && approxM < 450) members.push(o);
      });
      members.forEach((m) => used.add(m.id));
      out.push({
        id: `c-${i}`,
        title: `${g.department || "General"} cluster`,
        department: g.department,
        reports: members.length,
        lat: g.latitude,
        lng: g.longitude,
        emergency: members.some((m) => m.emergency),
        members,
      });
    });
    return out;
  }, [allGrievances]);

  const insights = useMemo(() => {
    const items = allGrievances;
    if (items.length < 3) return ["Insufficient data for trend analysis."];
    const notes = [];
    const real = items.filter((g) => !g.isDemo);
    const demo = items.filter((g) => g.isDemo);
    if (demo.length) notes.push(`${demo.length} records are tagged demo/sample data.`);
    const n = items.length;
    const by = {};
    items.forEach((g) => {
      const d = g.department || "General";
      by[d] = (by[d] || 0) + 1;
    });
    const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
    if (top) notes.push(`${top[0]} complaints represent ${Math.round((100 * top[1]) / n)}% of the current backlog.`);
    const weekMs = 7 * 24 * 3600 * 1000;
    const ts = (g) => (g.createdAt?.toDate ? g.createdAt.toDate().getTime() : 0);
    const thisWeek = items.filter((g) => ts(g) && Date.now() - ts(g) < weekMs);
    const lastWeek = items.filter((g) => ts(g) && Date.now() - ts(g) >= weekMs && Date.now() - ts(g) < 2 * weekMs);
    const waterNow = thisWeek.filter((g) => g.department === "Water").length;
    const waterPrev = lastWeek.filter((g) => g.department === "Water").length;
    if (waterPrev > 0) {
      const pct = Math.round((100 * (waterNow - waterPrev)) / waterPrev);
      notes.push(`Water complaints ${pct >= 0 ? "increased" : "changed"} ${Math.abs(pct)}% vs the prior week.`);
    }
    const em = items.filter((g) => g.emergency).length;
    if (em) notes.push(`${em} grievances are flagged as emergencies.`);
    const hot = clusters.filter((c) => c.reports >= 2)[0];
    if (hot) notes.push(`${hot.reports} reports cluster as one ${hot.department} civic issue.`);
    if (!real.length) notes.push("No live citizen records yet — insights include demo rows.");
    return notes;
  }, [allGrievances, clusters]);

  if (!user) {
    return (
      <div className="auth-container">
        <Starfield />
        <div className="auth-card">
          <div className="tabs" style={{ marginBottom: 20 }}>
            <button className={`tab ${authMode === "login" ? "active" : ""}`} onClick={() => { setAuthMode("login"); setAuthError(""); }}>Citizen Login</button>
            <button className={`tab ${authMode === "register" ? "active" : ""}`} onClick={() => { setAuthMode("register"); setAuthError(""); }}>Register</button>
            <button className={`tab ${authMode === "admin" ? "active" : ""}`} onClick={() => { setAuthMode("admin"); setAuthError(""); }}>Authority Admin</button>
          </div>

          {authMode === "login" && (
            <>
              <h2>🔐 Welcome Back</h2>
              <p className="muted text-center mb-lg">
                Sign in to manage your grievances
              </p>
              <label className="sr-only" htmlFor="login-email">Email Address</label>
              <input
                id="login-email"
                className="input"
                type="email"
                placeholder="Email Address"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <br /><br />
              <div className="password-wrap">
                <label className="sr-only" htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="input"
                  type={showLoginPassword ? "text" : "password"}
                  placeholder="Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showLoginPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                >
                  {showLoginPassword ? "🙈" : "👁️"}
                </button>
              </div>
              <br /><br />
              <button className="btn primary" onClick={login} style={{ width: "100%" }}>
                <span>🚀 Login</span>
              </button>
              <p className="text-center mt-md">
                New user?{" "}
                <span className="auth-link" role="button" tabIndex={0} onClick={() => setAuthMode("register")}>
                  Register here
                </span>
              </p>
            </>
          )}

          {authMode === "admin" && (
            <>
              <h2>🛡 Authority Admin Portal</h2>
              <p className="muted text-center mb-lg">
                Authorized Login for City Authority & Command Center
              </p>
              <input
                className="input"
                type="email"
                placeholder="Admin Email (e.g. admin@grievancenet.com)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <br /><br />
              <div className="password-wrap">
                <input
                  className="input"
                  type={showLoginPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                >
                  {showLoginPassword ? "🙈" : "👁️"}
                </button>
              </div>
              <br /><br />
              <button className="btn primary" onClick={login} style={{ width: "100%" }}>
                <span>🛡 Sign in to Command Center</span>
              </button>
            </>
          )}

          {authMode === "register" && (
            <>
              <h2>📝 Citizen Registration</h2>
              <p className="muted text-center mb-md">Creates a citizen account linked securely to your grievances.</p>
              <input className="input" placeholder="Full Name *" value={name} onChange={(e) => setName(e.target.value)} />
              <br /><br />
              <input className="input" type="email" placeholder="Email Address *" value={email} onChange={(e) => setEmail(e.target.value)} />
              <br /><br />
              <input className="input" type="tel" placeholder="Phone Number *" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              <br /><br />
              <div className="password-wrap">
                <input
                  className="input"
                  type={showRegisterPassword ? "text" : "password"}
                  placeholder="Password (min 6 chars) *"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                >
                  {showRegisterPassword ? "🙈" : "👁️"}
                </button>
              </div>
              <br /><br />
              <button className="btn primary" onClick={register} style={{ width: "100%" }}>
                Register Account
              </button>
              <p className="text-center mt-md">
                Already registered?{" "}
                <span className="auth-link" role="button" tabIndex={0} onClick={() => setAuthMode("login")}>
                  Login
                </span>
              </p>
            </>
          )}

          {authError && (
            <p className={`auth-error ${authError.includes("successfully") ? "success" : "error"}`}>
              {authError}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (isAdmin) {
    const critical = allGrievances.filter((g) => g.emergency || g.severity === "Critical" || (g.priorityScore || 0) >= 90);
    const high = allGrievances.filter((g) => !critical.includes(g) && (g.severity === "High" || (g.priorityScore || 0) >= 70));
    const normal = allGrievances.filter((g) => !critical.includes(g) && !high.includes(g));
    const filtered = allGrievances.filter((g) => {
      if (mapFilter === "All") return true;
      if (mapFilter === "Critical") return g.emergency || g.severity === "Critical";
      if (mapFilter === "Resolved") return g.status === "Resolved";
      if (mapFilter === "Pending") return g.status === "Submitted" || g.status === "Pending";
      return g.department === mapFilter || g.severity === mapFilter;
    });

    return (
      <div className="app-container">
        <Starfield />
        <header className="hero">
          <div className="hero-inner">
            <h1>🛡 CivicFlow AI Command Center</h1>
            <p className="tagline">Authority queue, hotspots, clusters, SLA tracking, and Office Kit handoff.</p>
          </div>
          <button className="btn ghost" onClick={logout}>Logout</button>
        </header>

        <div className="tabs" role="tablist">
          {["queue", "map", "clusters", "sla", "insights", "office", "inbox"].map((t) => (
            <button key={t} className={`tab ${adminTab === t ? "active" : ""}`} onClick={() => setAdminTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {adminTab === "queue" && (
          <div className="content">
            <div className="card">
              <h2>AI Action Queue</h2>
              <QueueColumn title="CRITICAL" items={critical} updateStatus={updateStatus} slaMinutes={slaMinutes} />
              <QueueColumn title="HIGH" items={high} updateStatus={updateStatus} slaMinutes={slaMinutes} />
              <QueueColumn title="NORMAL" items={normal} updateStatus={updateStatus} slaMinutes={slaMinutes} />
            </div>
            <aside className="sidebar">
              <div className="card small">
                <h4>Live Incident Counts</h4>
                <p>Total: {allGrievances.length} · Critical: {critical.length} · High: {high.length} · Normal: {normal.length}</p>
                <button className="btn secondary" onClick={seedDemo}>Load demo sample data</button>
                <p className="muted">Demo rows are tagged isDemo and marked distinctly in orange.</p>
              </div>
            </aside>
          </div>
        )}

        {adminTab === "map" && (
          <div className="card">
            <h2>Hotspot Map</h2>
            <div className="tabs">
              {["All", "Critical", "High", "Municipal", "Water", "Electricity", "Police", "Health", "Resolved", "Pending"].map((f) => (
                <button key={f} className={`tab ${mapFilter === f ? "active" : ""}`} onClick={() => setMapFilter(f)}>{f}</button>
              ))}
            </div>
            <div className="map-wrap">
              <Suspense fallback={<p className="muted">Loading map…</p>}>
                <HotspotMap filtered={filtered} clusters={clusters} />
              </Suspense>
            </div>
          </div>
        )}

        {adminTab === "clusters" && (
          <div className="card">
            <h2>Geographic Issue Clusters</h2>
            {clusters.length === 0 && <p className="muted">No mapped clusters detected.</p>}
            {clusters.map((c) => (
              <div key={c.id} className="grievance-card">
                <p><strong>{c.title}</strong> {c.emergency && <span className="badge badge-emergency">Emergency</span>}</p>
                <p>Reports: {c.reports} · Department: {c.department}</p>
                <p className="muted">Coordinates: {c.lat}, {c.lng}</p>
              </div>
            ))}
          </div>
        )}

        {adminTab === "sla" && (
          <div className="card">
            <h2>SLA & Escalation Monitoring</h2>
            <p className="muted">Target Response: Critical {slaMinutes.Critical}m · High {slaMinutes.High}m · Medium {slaMinutes.Medium}m · Low {slaMinutes.Low}m</p>
            {allGrievances.map((g) => {
              const dead = g.slaDeadlineMs || slaDeadlineFrom(g.createdAt, g.severity, slaMinutes);
              const st = slaState(dead, g.status);
              return (
                <div key={g.id} className="grievance-card">
                  <p><strong>{g.summary || g.problem}</strong></p>
                  <p>SLA State: <span className={st.breached ? "badge badge-emergency" : "badge badge-high"}>{st.breached ? "SLA BREACHED" : st.label}</span></p>
                  {st.breached && (
                    <p className="muted">
                      AI recommends escalation because response target was exceeded.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {adminTab === "insights" && (
          <div className="card">
            <h2>Authority AI Insights</h2>
            {insights.map((n) => <p key={n}>• {n}</p>)}
          </div>
        )}

        {adminTab === "office" && (
          <div className="card">
            <h2>Office Kit Receive Desk</h2>
            <p className="muted">
              Paste structured <code>civicflow.officekit.v1</code> JSON packet from citizen phone transfer.
            </p>
            <textarea className="input textarea" rows={8} value={handoffText} onChange={(e) => setHandoffText(e.target.value)} placeholder="Paste civicflow.officekit.v1 JSON packet" />
            <div className="actions">
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    const parsed = JSON.parse(handoffText);
                    const g = parsed.grievance || parsed;
                    await addDoc(collection(db, "grievances"), {
                      userId: user.uid,
                      citizenId: user.uid,
                      citizenEmail: user.email || "",
                      citizenName: "Phone Office Kit Handoff",
                      problem: g.problem || "",
                      city: g.city || "",
                      detailedLocation: g.landmark || g.detailedLocation || "",
                      latitude: g.latitude ?? null,
                      longitude: g.longitude ?? null,
                      department: g.department || "General",
                      category: g.category || "",
                      summary: g.summary || g.problem || "",
                      severity: g.severity || "Medium",
                      priorityScore: g.priorityScore ?? 50,
                      priorityReason: g.priorityReason || "Imported via Office Kit packet.",
                      routingReason: g.routingReason || "",
                      confidence: g.confidence ?? 0,
                      emergency: !!g.emergency,
                      emergencyReason: g.emergencyReason || "",
                      status: "Submitted",
                      createdAt: serverTimestamp(),
                      updatedAt: serverTimestamp(),
                      source: "officekit-handoff",
                      isDemo: false,
                      slaMinutes: slaMinutes[g.severity] || 1440,
                      slaDeadlineMs: Date.now() + (slaMinutes[g.severity] || 1440) * 60 * 1000,
                    });
                    alert(`Imported phone packet: ${g.problem || "grievance"}`);
                    setHandoffText("");
                  } catch {
                    alert("Invalid JSON — paste a civicflow.officekit.v1 packet.");
                  }
                }}
              >
                Import Packet to Command Center
              </button>
            </div>
          </div>
        )}

        {adminTab === "inbox" && (
          <AdminDashboard grievances={allGrievances} updateStatus={updateStatus} />
        )}
      </div>
    );
  }

  return (
    <div className="app-container">
      <Starfield />
      <header className="hero header-hero">
        <div className="hero-inner">
          <h1>📢 AI Grievance Assistant</h1>
          <p className="tagline">
            Report civic issues in plain language — AI helps you draft and submit clear grievance requests efficiently.
          </p>
        </div>
        <button className="btn logout-btn" onClick={logout}>
          🚪 Logout
        </button>
      </header>

      <main className="content">
        <div className="card">
          {page === 0 && (
            <div className="form">
              <h2>👋 Welcome to CivicFlow AI</h2>
              <p className="muted welcome-text">
                Your voice matters. Track your submitted complaints or raise a new grievance to make your community better.
              </p>
              
              <div className="actions welcome-actions" style={{ marginTop: 20 }}>
                <button className="btn primary" onClick={() => setPage(3)}>
                  📊 View My Complaints ({grievances.length})
                </button>
                <button className="btn secondary" onClick={() => setPage(1)}>
                  ➕ Raise New Complaint
                </button>
                <button className="btn ghost" onClick={() => setPage(4)}>
                  💬 AI Assistant
                </button>
              </div>

              <div className="tip-highlight">
                💡 <strong>Tip:</strong> Use our AI-powered assistant to automatically draft professional grievance emails based on your description.
              </div>
            </div>
          )}

          {page === 1 && (
            <div className="form">
              <label className="label" htmlFor="problem">Describe your problem</label>
              <textarea
                id="problem"
                rows="5"
                className="input textarea"
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="E.g., Transformer sparking near homes, garbage accumulating..."
              />
              <div className="mic-row">
                <button type="button" className="btn secondary" onClick={toggleVoice} aria-label="Record voice complaint">
                  {listening ? "⏹ Stop Voice" : "🎤 Speak Complaint"}
                </button>
                <span className="muted">Speech-to-text transcript is editable before submission.</span>
              </div>

              <label className="label" htmlFor="city">City / Area</label>
              <input
                id="city"
                type="text"
                className="input"
                placeholder="Enter city or area (e.g. Kanuru, Vijayawada)"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />

              <label className="label" htmlFor="photo">Attach Photo Evidence</label>
              <input
                id="photo"
                className="input file"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onPickImage(e.target.files[0])}
              />
              {imagePreview && <img className="preview-img" src={imagePreview} alt="Selected evidence" />}

              <div className="actions">
                <button className="btn primary" onClick={analyzeMultimodal} disabled={loading}>
                  {loading ? "Analyzing with AI…" : "🤖 Analyze Issue with AI"}
                </button>
                {aiData ? (
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setPage(2);
                      checkDuplicates({
                        problem,
                        department: aiData?.department,
                        latitude: coords?.lat,
                        longitude: coords?.lng,
                      });
                    }}
                  >
                    Proceed to Location & Submit →
                  </button>
                ) : (
                  <button className="btn ghost" onClick={() => setPage(2)}>
                    Skip AI & proceed directly →
                  </button>
                )}
              </div>

              {aiData && (
                <div className="ai-preview">
                  <h3>✨ AI-Generated Draft</h3>
                  <p className="muted" style={{ marginBottom: 12 }}>Review the auto-generated grievance mail below</p>
                  
                  <textarea
                    className="input textarea"
                    rows={8}
                    value={mailBody}
                    onChange={(e) => setMailBody(e.target.value)}
                  />

                  <div className="ai-advice">
                    <h3>💡 Recommended Action Steps</h3>
                    <p>
                      This appears to be a <strong>{aiData.department || "Municipal"}</strong> civic grievance. Include a photo, precise landmark, and GPS so authorities can verify and cluster related reports.
                    </p>
                    <div className="intel-grid" style={{ margin: "14px 0" }}>
                      <span className={badgeClass(aiData.severity, aiData.emergency)}>📋 Department: {aiData.department}</span>
                      <span className={badgeClass(aiData.severity, false)}>{aiData.severity} · Priority {aiData.priorityScore}/100</span>
                      {aiData.emergency && <span className="badge badge-emergency">EMERGENCY</span>}
                    </div>
                    <p><strong>📝 Summary:</strong> {aiData.summary || problem}</p>
                    {aiData.routingReason && <p><strong>Routing Reason:</strong> {aiData.routingReason}</p>}
                    {aiData.priorityReason && <p><strong>Priority Rationale:</strong> {aiData.priorityReason}</p>}
                    <p className="muted" style={{ marginTop: 10 }}>
                      AI Confidence: {Math.round((aiData.confidence || 0) * 100)}% · Layer: {aiData.aiLayer || "hybrid"}
                    </p>
                  </div>

                  {aiData.emergency && (
                    <div className="emergency-banner" style={{ marginTop: 16 }}>
                      <p><strong>Immediate Action:</strong> {aiData.immediateAction || "Call 112 for urgent response."}</p>
                      <p>{aiData.emergencyReason}</p>
                      <a className="btn primary" href={`tel:${aiData.emergencyPhone || "112"}`}>📞 Call Emergency 112</a>
                      <p className="muted">CivicFlow provides guidance; it has not automatically dispatched help.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {page === 2 && (
            <div className="form">
              <h2>📍 Location Details</h2>
              <p className="muted welcome-text">Pin your exact location for faster resolution</p>

              <div className="row space-between" style={{ marginTop: 16 }}>
                <button className="btn secondary" onClick={getCurrentLocation}>📍 Use Current Location</button>
                <button className="btn ghost" onClick={() => setPage(1)}>← Back</button>
              </div>

              {coords && (
                <p className="muted" style={{ marginTop: 8 }}>Lat: {coords.lat.toFixed(6)} | Lng: {coords.lng.toFixed(6)}</p>
              )}

              <div className="map-wrap">
                <Suspense fallback={<p className="muted">Loading map…</p>}>
                  <CitizenMap coords={coords} setCoords={setCoords} />
                </Suspense>
              </div>

              <label className="label" htmlFor="landmark">Detailed location</label>
              <input
                id="landmark"
                type="text"
                className="input"
                placeholder="E.g., Near ABC Hospital, 2nd cross street"
                value={detailedLocation}
                onChange={(e) => setDetailedLocation(e.target.value)}
              />

              <label className="label" htmlFor="mail-body-step2">Mail body</label>
              <textarea
                id="mail-body-step2"
                rows={8}
                className="input textarea"
                placeholder="Auto-generated grievance mail report..."
                value={mailBody}
                onChange={(e) => setMailBody(e.target.value)}
              />

              <label className="label" htmlFor="photo-step2">Attach photo (optional)</label>
              <input
                id="photo-step2"
                className="input file"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onPickImage(e.target.files[0])}
              />
              {imagePreview && <img className="preview-img" src={imagePreview} alt="Selected evidence" />}

              {duplicates.length > 0 && (
                <div className="ai-preview" style={{ marginTop: 20 }}>
                  <h3>Possible Duplicate Incident Detected</h3>
                  {duplicates.map((d) => (
                    <div key={d.id} className="grievance-card">
                      <p><strong>Existing Report:</strong> {d.problem}</p>
                      <p className="muted">Status: {d.status} · Similarity: {Math.round((d.similarity || 0) * 100)}% · Distance: {d.distanceMeters != null ? `${Math.round(d.distanceMeters)} m` : "nearby"}</p>
                    </div>
                  ))}
                  <div className="actions">
                    <button className="btn secondary" onClick={() => setPage(3)}>Track Existing Complaint</button>
                    <button className="btn ghost" onClick={() => setDuplicates([])}>Submit New Report Anyway</button>
                  </div>
                </div>
              )}

              <div className="actions" style={{ marginTop: 24 }}>
                <button className="btn primary" onClick={sendEmail}>📤 Submit Grievance</button>
              </div>
            </div>
          )}

          {page === 3 && (
            <div className="form">
              <h2>📊 My Complaints</h2>
              {grievances.length === 0 && (
                <p className="muted">No grievances submitted yet.</p>
              )}
              {grievances.map((g) => {
                const dead = g.slaDeadlineMs || slaDeadlineFrom(g.createdAt, g.severity, slaMinutes);
                const st = slaState(dead, g.status);
                const code = `CF-${g.id.substring(0, 8).toUpperCase()}`;
                return (
                  <div key={g.id} className="card small grievance-card" style={{ marginBottom: 16 }}>
                    <div className="row space-between" style={{ alignItems: "center" }}>
                      <span className="code-pill">{code}</span>
                      <span className={badgeClass(g.severity, g.emergency)}>{g.department || "General"} · {g.severity}</span>
                    </div>
                    <p style={{ marginTop: 8 }}><strong>Problem:</strong> {g.problem}</p>
                    <p className="muted">Location: {g.city || g.detailedLocation || "Captured via GPS"}</p>
                    <p>
                      <strong>Real-Time Status:</strong>{" "}
                      <span className={`status-pill status-${(g.status || "Submitted").toLowerCase().replace(/\s+/g, "-")}`}>
                        {g.status || "Submitted"}
                      </span>
                    </p>
                    <p className="muted">SLA: {st.breached ? "SLA BREACHED" : st.label}</p>
                    <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setSelectedGrievanceId(g.id)}>
                      🔍 View Full Details & Timeline
                    </button>
                  </div>
                );
              })}
              <button className="btn ghost" onClick={() => setPage(0)}>
                ← Back to Home
              </button>
            </div>
          )}

          {page === 4 && (
            <div className="form">
              <h2>Citizen AI Assistant</h2>
              <p className="muted">Ask about department routing, priority scores, duplicates, or what to attach.</p>
              <textarea className="input textarea" rows={3} value={assistantQ} onChange={(e) => setAssistantQ(e.target.value)} placeholder="What department handles broken streetlights?" />
              <div className="actions">
                <button className="btn primary" onClick={askAssistant}>Ask Assistant</button>
                <button className="btn ghost" onClick={() => setPage(0)}>Back</button>
              </div>
              {assistantA && <div className="ai-preview"><p>{assistantA}</p></div>}
            </div>
          )}
        </div>

        <aside className="sidebar">
          <div className="card small tip-card">
            <h4>💡 Quick Tips</h4>
            <ul className="tip-list">
              <li>✓ Be clear and concise in your description</li>
              <li>✓ Include exact location details</li>
              <li>✓ Attach photos for faster verification</li>
              <li>✓ Use the map to pinpoint the spot</li>
            </ul>
          </div>
          <div className="card small tip-card">
            <h4>🤖 AI Assistant</h4>
            <p className="muted">
              Powered by Google Gemini AI to help you draft professional grievance emails automatically.
            </p>
          </div>
          <div className="card small tip-card">
            <h4>🔒 Privacy</h4>
            <p className="muted">
              Your data is secure. Nothing is sent without your explicit action.
            </p>
          </div>
        </aside>
      </main>

      {/* Complaint Details Modal */}
      {selectedGrievance && (
        <div className="modal-overlay" onClick={() => setSelectedGrievanceId(null)}>
          <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
            <div className="row space-between">
              <h2>Grievance Details ({`CF-${selectedGrievance.id.substring(0, 8).toUpperCase()}`})</h2>
              <button className="btn ghost" onClick={() => setSelectedGrievanceId(null)}>✕ Close</button>
            </div>
            <hr style={{ borderColor: "rgba(255,255,255,0.1)", margin: "12px 0" }} />
            
            {/* Status Timeline */}
            <h4>Status Timeline</h4>
            <div className="timeline-container">
              {STATUS_STEPS.map((step, idx) => {
                const currentIdx = STATUS_STEPS.indexOf(selectedGrievance.status || "Submitted");
                const isPassed = idx <= currentIdx;
                return (
                  <div key={step} className={`timeline-step ${isPassed ? "active" : ""}`}>
                    <div className="step-circle">{idx + 1}</div>
                    <span className="step-label">{step}</span>
                  </div>
                );
              })}
            </div>

            <p><strong>Description:</strong> {selectedGrievance.problem}</p>
            <p><strong>Department:</strong> {selectedGrievance.department} | <strong>Category:</strong> {selectedGrievance.category}</p>
            <p><strong>Location:</strong> {selectedGrievance.city || selectedGrievance.detailedLocation || "GPS Coordinates"}</p>
            {selectedGrievance.latitude && selectedGrievance.longitude && (
              <p className="muted">
                Coordinates: {selectedGrievance.latitude}, {selectedGrievance.longitude}{" "}
                <a
                  href={`https://www.google.com/maps?q=${selectedGrievance.latitude},${selectedGrievance.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#7c3aed" }}
                >
                  (Open Google Maps)
                </a>
              </p>
            )}

            {(selectedGrievance.photoUrl || selectedGrievance.imageUrl) && (
              <div>
                <h4>Attached Evidence Photo:</h4>
                <img className="preview-img" src={selectedGrievance.photoUrl || selectedGrievance.imageUrl} alt="Grievance evidence" />
              </div>
            )}

            <h4>AI Analysis Rationale</h4>
            <p><strong>AI Summary:</strong> {selectedGrievance.summary}</p>
            <p><strong>Severity:</strong> {selectedGrievance.severity} | <strong>Priority Score:</strong> {selectedGrievance.priorityScore}/100</p>
            <p><strong>Priority Reason:</strong> {selectedGrievance.priorityReason}</p>
            <p><strong>Routing Reason:</strong> {selectedGrievance.routingReason}</p>
            {selectedGrievance.emergency && (
              <div className="emergency-banner">
                <p><strong>🚨 Emergency Flag:</strong> {selectedGrievance.emergencyReason}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`loading-overlay ${loading ? "visible" : ""}`} aria-live="polite">
        <div className="loading-text">Analyzing...</div>
      </div>
    </div>
  );
}

function CitizenMap({ coords, setCoords }) {
  const [MapMod, setMapMod] = useState(null);
  useEffect(() => {
    import("./MapView").then(setMapMod);
  }, []);
  if (!MapMod) return null;
  const { default: MapViewInner, LocationPicker, Marker } = MapMod;
  return (
    <MapViewInner center={[coords?.lat || 16.5062, coords?.lng || 80.648]} zoom={13}>
      <LocationPicker setCoords={setCoords} />
      {coords && <Marker position={[coords.lat, coords.lng]} />}
    </MapViewInner>
  );
}

function HotspotMap({ filtered, clusters }) {
  const [MapMod, setMapMod] = useState(null);
  useEffect(() => {
    import("./MapView").then(setMapMod);
  }, []);
  if (!MapMod) return null;
  const { default: MapViewInner, Marker, Circle } = MapMod;
  return (
    <MapViewInner center={[17.385, 78.486]} zoom={12}>
      {filtered.map((g) =>
        g.latitude != null && g.longitude != null ? (
          <Marker key={g.id} position={[g.latitude, g.longitude]} />
        ) : null
      )}
      {clusters.map((c) => (
        <Circle
          key={c.id}
          center={[c.lat, c.lng]}
          radius={Math.min(900, 180 * c.reports)}
          pathOptions={{ color: c.emergency ? "#ef4444" : "#667eea", fillOpacity: 0.15 }}
        />
      ))}
    </MapViewInner>
  );
}

function QueueColumn({ title, items, updateStatus, slaMinutes }) {
  return (
    <div className="queue-col" style={{ marginTop: 18 }}>
      <h3>{title} · {items.length} incidents</h3>
      {items.map((g) => {
        const dead = g.slaDeadlineMs || slaDeadlineFrom(g.createdAt, g.severity, slaMinutes);
        const st = slaState(dead, g.status);
        const code = `CF-${g.id.substring(0, 8).toUpperCase()}`;
        return (
          <div key={g.id} className="grievance-card">
            <div className="row space-between">
              <span className="code-pill">{code}</span>
              {g.isDemo && <span className="badge badge-medium">DEMO / SAMPLE</span>}
            </div>
            {g.emergency && <span className="badge badge-emergency">Emergency</span>}
            <p style={{ marginTop: 6 }}><strong>{g.category || g.summary || g.problem}</strong></p>
            <p>{g.city} · Score {g.priorityScore ?? "—"} · {g.department}</p>
            <p className="muted">{g.priorityReason || g.emergencyReason}</p>
            <p>SLA: {st.breached ? "SLA BREACHED" : st.label}</p>
            <select
              className="status-select"
              value={g.status || "Submitted"}
              onChange={(e) => updateStatus(g.id, e.target.value)}
              aria-label="Update grievance status"
            >
              <option value="Submitted">Submitted</option>
              <option value="Under Review">Under Review</option>
              <option value="Assigned">Assigned</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
        );
      })}
    </div>
  );
}

function AdminDashboard({ grievances, updateStatus }) {
  return (
    <div className="card">
      <h2>🛠 Admin Grievance Panel</h2>
      {grievances.map((g) => (
        <div key={g.id} className="grievance-card">
          <p><b>ID:</b> <code>{`CF-${g.id.substring(0, 8).toUpperCase()}`}</code></p>
          <p><b>Issue:</b> {g.problem}</p>
          <p><b>City:</b> {g.city}</p>
          <p className="muted">
            <b>Submitted:</b>{" "}
            {g.createdAt?.toDate ? g.createdAt.toDate().toLocaleString() : "Just now"}
          </p>
          {g.latitude && g.longitude && (
            <p><b>📍 Location:</b> {g.latitude}, {g.longitude}</p>
          )}
          {g.detailedLocation && <p><b>🏷 Landmark:</b> {g.detailedLocation}</p>}
          <div className="status-row">
            <span className="status-label">Status:</span>
            <select
              className={`status-select status-${(g.status || "Submitted").toLowerCase().replace(/\s+/g, "-")}`}
              value={g.status || "Submitted"}
              onChange={(e) => updateStatus(g.id, e.target.value)}
            >
              <option value="Submitted">Submitted</option>
              <option value="Under Review">Under Review</option>
              <option value="Assigned">Assigned</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}
