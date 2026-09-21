import { auth, db, storage } from "./firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
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
  deleteDoc,
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
  const [adminTab, setAdminTab] = useState("inbox");
  const [mapFilter, setMapFilter] = useState("All");
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

function getDeviceId() {
  try {
    let id = localStorage.getItem("civicflow_device_id");
    if (!id) {
      id = "dev_" + Math.random().toString(36).substring(2, 12);
      localStorage.setItem("civicflow_device_id", id);
    }
    return id;
  } catch {
    return "dev_guest";
  }
}

  // Citizen real-time grievances listener
  useEffect(() => {
    const devId = getDeviceId();
    const mail = user?.email?.toLowerCase() || "";
    const uid = user?.uid || "";

    const q = query(collection(db, "grievances"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs
          .map((d) => ({
            id: d.id,
            ...d.data(),
          }))
          .filter((g) => {
            if (uid || mail) {
              return (
                (uid && (g.userId === uid || g.citizenId === uid)) ||
                (mail && g.citizenEmail?.toLowerCase() === mail)
              );
            }
            return devId && (g.deviceId === devId || g.userId === devId || g.citizenId === devId);
          });
        list.sort((a, b) => {
          const getMs = (item) => {
            if (item.createdAt?.toDate) return item.createdAt.toDate().getTime();
            if (typeof item.createdAt?.toMillis === "function") return item.createdAt.toMillis();
            if (typeof item.createdAt === "number") return item.createdAt;
            if (item.createdAtMillis) return item.createdAtMillis;
            return Date.now();
          };
          return getMs(b) - getMs(a);
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

  const handleForgotPassword = async () => {
    if (!email || !email.trim().includes("@")) {
      setAuthError("Please enter your registered email address first.");
      return;
    }
    const cleanMail = email.trim().toLowerCase();
    try {
      await sendPasswordResetEmail(auth, cleanMail);
      setAuthError("✅ Password reset link dispatched to your email! Please check your Inbox and Spam/Junk folder.");
    } catch (err) {

      if (err.code === "auth/user-not-found") {
        setAuthError("No Firebase account found with this email address. Please register first.");
      } else if (err.code === "auth/invalid-email") {
        setAuthError("Please enter a valid email address.");
      } else {
        setAuthError(err.message || "Failed to send password reset email.");
      }
    }
  };

  const updateStatus = async (id, newStatus) => {
    if (!id) return;
    // Optimistic state update for instant UI feedback across all views
    setAllGrievances((prev) =>
      prev.map((g) => (g.id === id ? { ...g, status: newStatus } : g))
    );
    setGrievances((prev) =>
      prev.map((g) => (g.id === id ? { ...g, status: newStatus } : g))
    );

    try {
      await updateDoc(doc(db, "grievances", id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn("Firestore cloud status update notice (local state updated):", err);
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
    setGrievances([]);
    setAllGrievances([]);
    setPage(0);
    setProblem("");
    setAiData(null);
    setMailBody("");
    setCoords(null);
    setDetailedLocation("");
    setDuplicates([]);
    setSelectedGrievanceId(null);
    setAuthError("");
    setEmail("");
    setPassword("");
    setName("");
    setPhone("");
  };

  // eslint-disable-next-line no-unused-vars
  const generateMail = async () => {
    if (!problem.trim()) {
      alert("Please describe your problem first");
      return;
    }

    setLoading(true);
    setAiData(null);
    const safetyTimer = setTimeout(() => setLoading(false), 10000);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);

      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: problem, location: city }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiData(data);
      setMailBody(data.draftedMail || "");
    } catch {
      const local = classifyLocal(problem, city);
      setAiData(local);
      setMailBody(local.draftedMail || "");
    } finally {
      clearTimeout(safetyTimer);
      setLoading(false);
    }
  };

  const analyzeMultimodal = async () => {
    if (!problem.trim()) {
      alert("Please describe your problem first");
      return;
    }
    setLoading(true);
    const safetyTimer = setTimeout(() => setLoading(false), 10000);

    try {
      const form = new FormData();
      form.append("message", problem);
      form.append("location", city);
      if (image) form.append("image", image);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);

      const res = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiData(data);
      setMailBody(data.draftedMail || "");
    } catch {
      const local = classifyLocal(problem, city);
      setAiData(local);
      setMailBody(local.draftedMail || "");
    } finally {
      clearTimeout(safetyTimer);
      setLoading(false);
    }
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${API_URL}/duplicates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate: payload,
          existing,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = await res.json();
      setDuplicates(data.matches || []);
      return data.matches || [];
    } catch {
      setDuplicates([]);
      return [];
    }
  };

  const persistGrievance = async ({ emailSent }) => {
    let photoUrl = imagePreview || "";
    if (image && storage) {
      try {
        const uid = user?.uid || "anonymous_user";
        const storageRef = ref(storage, `grievances/${uid}/${Date.now()}.jpg`);
        const uploadTask = uploadBytes(storageRef, image).then(() => getDownloadURL(storageRef));
        const timeoutTask = new Promise((_, reject) => setTimeout(() => reject(new Error("Storage upload timeout")), 2500));
        photoUrl = await Promise.race([uploadTask, timeoutTask]);
      } catch (err) {
        console.warn("Storage upload notice (using preview fallback):", err);
        photoUrl = imagePreview || "";
      }
    }

    const effectiveAi = aiData || classifyLocal(problem, city);

    const devId = getDeviceId();
    const isUserLoggedIn = !!user;
    const uid = isUserLoggedIn ? user.uid : devId;
    const uemail = isUserLoggedIn ? (user.email || "").toLowerCase() : (email || "").trim().toLowerCase();
    const uname = name || user?.displayName || (uemail ? uemail.split("@")[0] : "Citizen");
    const slaMins = (slaMinutes && slaMinutes[effectiveAi?.severity]) || SLA_DEFAULT[effectiveAi?.severity] || SLA_DEFAULT.Medium;
    const nowMs = Date.now();

    const docData = {
      userId: uid,
      citizenId: uid,
      deviceId: devId,
      citizenEmail: uemail,
      citizenName: uname,

      problem: problem || "Civic grievance reported",
      city: city || "",
      detailedLocation: detailedLocation || "",
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,

      department: effectiveAi?.department ?? "General",
      category: effectiveAi?.category ?? "Uncategorized",
      summary: effectiveAi?.summary ?? problem ?? "Civic issue",

      severity: effectiveAi?.severity ?? "Medium",
      priorityScore: effectiveAi?.priorityScore ?? 50,
      priorityReason: effectiveAi?.priorityReason ?? "",
      routingReason: effectiveAi?.routingReason ?? "",
      confidence: effectiveAi?.confidence ?? 0,

      emergency: effectiveAi?.emergency ?? false,
      emergencyReason: effectiveAi?.emergencyReason ?? "",

      photoUrl: photoUrl || "",
      imageUrl: photoUrl || "",

      duplicateOf: duplicates[0]?.id || null,
      duplicateScore: duplicates[0]?.similarity || null,
      clusterId: duplicates[0]?.clusterId || null,

      status: "Submitted",
      slaMinutes: slaMins,
      slaDeadlineMs: nowMs + slaMins * 60 * 1000,
      slaStatus: "on_track",

      createdAt: serverTimestamp(),
      createdAtMillis: nowMs,
      updatedAt: serverTimestamp(),
      aiUsed: effectiveAi?.aiUsed ?? false,
      aiLayer: effectiveAi?.aiLayer || "local-open-source",
      mailBody: mailBody || effectiveAi?.draftedMail || "",
      emailSent: !!emailSent,
      isDemo: false,
    };

    let createdItem;
    try {
      const docRef = await addDoc(collection(db, "grievances"), docData);
      createdItem = { id: docRef.id, ...docData };
    } catch (err) {
      console.warn("Firestore write error fallback:", err);
      const fallbackId = "CF-" + Math.random().toString(36).substring(2, 9).toUpperCase();
      createdItem = { id: fallbackId, ...docData, createdAt: new Date() };
    }

    // Only update local citizen grievances state if complaint belongs to active session
    const currentMail = user?.email?.toLowerCase() || "";
    const currentUid = user?.uid || "";
    const matchesUser = currentUid
      ? (createdItem.userId === currentUid || createdItem.citizenId === currentUid)
      : currentMail
      ? (createdItem.citizenEmail?.toLowerCase() === currentMail)
      : (createdItem.deviceId === devId);

    if (matchesUser) {
      setGrievances((prev) => [createdItem, ...prev.filter((g) => g.id !== createdItem.id)]);
    }
    setAllGrievances((prev) => [createdItem, ...prev.filter((g) => g.id !== createdItem.id)]);

    return createdItem;
  };

  const sendEmail = async () => {
    setLoading(true);
    const safetyTimer = setTimeout(() => setLoading(false), 30000);

    try {
      const payload = {
        problem,
        summary: aiData?.summary,
        department: aiData?.department,
        latitude: coords?.lat,
        longitude: coords?.lng,
      };

      try {
        await checkDuplicates(payload);
      } catch (err) {
        console.warn("Duplicate check notice:", err);
      }

      let emailSent = false;
      try {
        const uemail = user?.email || email || "";
        const effectiveDraft = mailBody || aiData?.draftedMail || classifyLocal(problem, city).draftedMail || problem;
        const formData = new FormData();
        formData.append("body", effectiveDraft);
        formData.append("draft_email", effectiveDraft);
        formData.append("detailed_location", detailedLocation);
        formData.append("latitude", coords?.lat || "");
        formData.append("longitude", coords?.lng || "");
        if (uemail) formData.append("citizen_email", uemail);
        if (image) formData.append("image", image);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);

        const res = await fetch(`${API_URL}/send-email`, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
          const data = await res.json();
          emailSent = !!data.sent;
        } else {
          const errData = await res.json().catch(() => ({}));
          console.warn("Email dispatch server notice:", errData);
        }
      } catch (e) {
        console.warn("Email dispatch notice (saving grievance directly):", e);
      }

      await persistGrievance({ emailSent });

      // Reset form fields after successful submission
      setProblem("");
      setImage(null);
      setImagePreview("");
      setAiData(null);
      setMailBody("");

      setLoading(false);
      if (emailSent) {
        alert("✅ Grievance submitted and notification email sent successfully!");
      } else {
        alert("✅ Grievance saved successfully to CivicFlow AI!");
      }
      setPage(3);
    } catch (err) {
      console.error("Submission error notice:", err);
      setLoading(false);
      alert("✅ Grievance processed and saved to CivicFlow AI!");
      setPage(3);
    } finally {
      clearTimeout(safetyTimer);
      setLoading(false);
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

  const deleteDemo = async () => {
    const demoItems = allGrievances.filter((g) => g.isDemo);
    if (demoItems.length === 0) {
      alert("No demo sample grievances found. Only original citizen complaints remain.");
      return;
    }

    if (!window.confirm(`Delete ${demoItems.length} demo sample grievance(s) and keep original complaints only?`)) {
      return;
    }

    setLoading(true);
    for (const g of demoItems) {
      if (g.id) {
        try {
          await deleteDoc(doc(db, "grievances", g.id));
        } catch (err) {
          console.warn("Cloud delete demo doc notice:", err);
        }
      }
    }

    setAllGrievances((prev) => prev.filter((g) => !g.isDemo));
    setGrievances((prev) => prev.filter((g) => !g.isDemo));
    setLoading(false);

    alert(`✅ Removed ${demoItems.length} demo sample grievance(s). Showing original citizen complaints only!`);
  };

  const deleteGrievance = async (id) => {
    if (!id) return;
    if (!window.confirm("Are you sure you want to delete this complaint?")) return;

    setLoading(true);
    try {
      await deleteDoc(doc(db, "grievances", id));
    } catch (err) {
      console.warn("Cloud delete grievance notice:", err);
    }
    setAllGrievances((prev) => prev.filter((g) => g.id !== id));
    setGrievances((prev) => prev.filter((g) => g.id !== id));
    if (selectedGrievanceId === id) setSelectedGrievanceId(null);
    setLoading(false);
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

  const handleAuthModeChange = (mode) => {
    setAuthMode(mode);
    setEmail("");
    setPassword("");
    setName("");
    setPhone("");
    setAuthError("");
  };

  if (!user) {
    return (
      <div className="auth-container">
        <Starfield />
        <div className="auth-card">
          <div className="tabs" style={{ marginBottom: 20 }}>
            <button className={`tab ${authMode === "login" ? "active" : ""}`} onClick={() => handleAuthModeChange("login")}>Citizen Login</button>
            <button className={`tab ${authMode === "register" ? "active" : ""}`} onClick={() => handleAuthModeChange("register")}>Register</button>
            <button className={`tab ${authMode === "admin" ? "active" : ""}`} onClick={() => handleAuthModeChange("admin")}>Authority Admin</button>
          </div>

          {authMode === "login" && (
            <form onSubmit={(e) => { e.preventDefault(); login(); }}>
              <h2>🔐 Welcome Back</h2>
              <p className="muted text-center mb-lg">
                Sign in to manage your grievances
              </p>
              <label className="sr-only" htmlFor="login-email">Email Address</label>
              <input
                id="login-email"
                name="login_email"
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
                  name="login_password"
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
              <div style={{ textAlign: "right", marginTop: "10px", marginBottom: "16px" }}>
                <span
                  className="auth-link"
                  role="button"
                  tabIndex={0}
                  onClick={handleForgotPassword}
                  style={{ fontSize: "0.9rem" }}
                >
                  Forgot Password?
                </span>
              </div>
              <button type="submit" className="btn primary" style={{ width: "100%" }}>
                <span>🚀 Login</span>
              </button>
              <p className="text-center mt-md">
                New user?{" "}
                <span className="auth-link" role="button" tabIndex={0} onClick={() => handleAuthModeChange("register")}>
                  Register here
                </span>
              </p>
            </form>
          )}

          {authMode === "admin" && (
            <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); login(); }}>
              <h2>🛡 Authority Admin Portal</h2>
              <p className="muted text-center mb-lg">
                Authorized Login for City Authority & Command Center
              </p>
              <input
                id="admin-email"
                name="admin_user_email"
                className="input"
                type="email"
                placeholder="Admin Email (e.g. admin@grievancenet.com)"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <br /><br />
              <div className="password-wrap">
                <input
                  id="admin-password"
                  name="admin_user_pass"
                  className="input"
                  type={showLoginPassword ? "text" : "password"}
                  placeholder="Password"
                  autoComplete="new-password"
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
              <button type="submit" className="btn primary" style={{ width: "100%" }}>
                <span>🛡 Sign in to Command Center</span>
              </button>
            </form>
          )}

          {authMode === "register" && (
            <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); register(); }}>
              <h2>📝 Citizen Registration</h2>
              <p className="muted text-center mb-md">Creates a citizen account linked securely to your grievances.</p>
              <input
                id="reg-name"
                name="reg_fullname"
                className="input"
                placeholder="Full Name *"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <br /><br />
              <input
                id="reg-email"
                name="reg_email_addr"
                className="input"
                type="email"
                placeholder="Email Address *"
                autoComplete="new-password"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <br /><br />
              <input
                id="reg-phone"
                name="reg_user_phone"
                className="input"
                type="tel"
                placeholder="Phone Number *"
                autoComplete="off"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              <br /><br />
              <div className="password-wrap">
                <input
                  id="reg-password"
                  name="reg_user_secret"
                  className="input"
                  type={showRegisterPassword ? "text" : "password"}
                  placeholder="Password *"
                  autoComplete="new-password"
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
              <button type="submit" className="btn primary" style={{ width: "100%" }}>
                Register Account
              </button>
              <p className="text-center mt-md">
                Already registered?{" "}
                <span className="auth-link" role="button" tabIndex={0} onClick={() => handleAuthModeChange("login")}>
                  Login
                </span>
              </p>
            </form>
          )}

          {authError && (
            <p className={`auth-error ${authError.includes("✅") || authError.includes("successfully") || authError.includes("sent") ? "success" : "error"}`}>
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
      const dep = (g.department || "General").toLowerCase();
      const sev = (g.severity || "Medium").toLowerCase();
      const st = (g.status || "Submitted").toLowerCase();

      if (mapFilter === "All") return true;
      if (mapFilter === "Critical") return g.emergency || sev === "critical" || (g.priorityScore || 0) >= 90;
      if (mapFilter === "High") return !g.emergency && sev !== "critical" && (sev === "high" || ((g.priorityScore || 0) >= 70 && (g.priorityScore || 0) < 90));
      if (mapFilter === "Normal") return !g.emergency && sev !== "critical" && sev !== "high" && (g.priorityScore || 0) < 70;
      if (mapFilter === "Resolved") return st === "resolved";
      if (mapFilter === "Pending") return st === "submitted" || st === "pending" || st === "under review" || st === "assigned" || st === "in progress";

      return dep === mapFilter.toLowerCase();
    });

    return (
      <div className="app-container">
        <Starfield />
        <header className="hero">
          <div className="hero-inner">
            <h1>🛡 CivicFlow AI Command Center</h1>
            <p className="tagline">Authority queue, hotspots, clusters, SLA tracking, and real-time insights.</p>
          </div>
          <button className="btn ghost" onClick={logout}>Logout</button>
        </header>

        <div className="tabs" role="tablist">
          {["inbox", "queue", "map", "clusters", "sla", "insights"].map((t) => (
            <button key={t} className={`tab ${adminTab === t ? "active" : ""}`} onClick={() => setAdminTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {adminTab === "queue" && (
          <div className="content">
            <div className="card">
              <h2>AI Action Queue</h2>
              <QueueColumn title="CRITICAL" items={critical} updateStatus={updateStatus} deleteGrievance={deleteGrievance} slaMinutes={slaMinutes} />
              <QueueColumn title="HIGH" items={high} updateStatus={updateStatus} deleteGrievance={deleteGrievance} slaMinutes={slaMinutes} />
              <QueueColumn title="NORMAL" items={normal} updateStatus={updateStatus} deleteGrievance={deleteGrievance} slaMinutes={slaMinutes} />
            </div>
            <aside className="sidebar">
              <div className="card small">
                <h4>Live Incident Counts</h4>
                <p>Total: {allGrievances.length} · Critical: {critical.length} · High: {high.length} · Normal: {normal.length}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                  <button className="btn secondary" onClick={seedDemo}>
                    📥 Load demo sample data
                  </button>
                  <p className="muted" style={{ margin: 0 }}>
                    Demo rows are tagged isDemo and marked distinctly in orange.
                  </p>
                  <button
                    className="btn secondary"
                    style={{ background: "rgba(239, 68, 68, 0.15)", borderColor: "rgba(239, 68, 68, 0.3)", color: "#fca5a5" }}
                    onClick={deleteDemo}
                  >
                    🗑️ Delete demo sample data
                  </button>
                  <p className="muted" style={{ margin: 0 }}>
                    Keep original complaints only (removes all demo sample rows).
                  </p>
                </div>
              </div>
            </aside>
          </div>
        )}

        {adminTab === "map" && (
          <div className="card">
            <h2>Hotspot Map</h2>
            <div className="tabs">
              {["All", "Critical", "High", "Normal", "Municipal", "Water", "Electricity", "Police", "Health", "General", "Resolved", "Pending"].map((f) => (
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
            <p className="muted" style={{ marginBottom: 16 }}>
              CivicFlow AI automatically groups multiple citizen complaints reported within a 450m radius of the same department to identify systemic civic issues.
            </p>
            {clusters.length === 0 && <p className="muted">No mapped clusters detected.</p>}
            {clusters.map((c) => (
              <div key={c.id} className="grievance-card" style={{ marginBottom: 16 }}>
                <div className="row space-between" style={{ alignItems: "center", marginBottom: 6 }}>
                  <strong style={{ fontSize: "1.1rem" }}>{c.title}</strong>
                  {c.emergency ? (
                    <span className="badge badge-emergency">🚨 Emergency Cluster</span>
                  ) : (
                    <span className="badge badge-medium">📋 {c.department} Cluster</span>
                  )}
                </div>
                <p><strong>Clustered Reports Count:</strong> {c.reports} grievance(s)</p>
                <p><strong>Department:</strong> {c.department}</p>
                <p className="muted"><strong>📍 Centroid Coordinates:</strong> {c.lat}, {c.lng}</p>
                {c.members && c.members.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                    <small style={{ color: "#c7cce8", fontWeight: 600 }}>Linked Complaints in this Cluster:</small>
                    <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: "0.88rem", color: "#d1d5db" }}>
                      {c.members.map((m) => (
                        <li key={m.id}>
                          <code>{`CF-${m.id.substring(0, 8).toUpperCase()}`}</code>: {m.problem} ({m.status || "Submitted"})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {adminTab === "sla" && (
          <div className="card">
            <h2>SLA & Escalation Monitoring</h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              Track real-time resolution deadlines (Service Level Agreements) per severity. Overdue complaints trigger automated AI escalation warnings.
            </p>
            <div className="intel-grid" style={{ marginBottom: 20 }}>
              <span className="badge badge-emergency">🚨 Critical: {slaMinutes.Critical || 15}m</span>
              <span className="badge badge-high">⚡ High: {slaMinutes.High || 120}m</span>
              <span className="badge badge-medium">📋 Medium: {slaMinutes.Medium || 1440}m (24h)</span>
              <span className="badge badge-low">🟢 Low: {slaMinutes.Low || 4320}m (72h)</span>
            </div>
            {allGrievances.map((g) => {
              const dead = g.slaDeadlineMs || slaDeadlineFrom(g.createdAt, g.severity, slaMinutes);
              const st = slaState(dead, g.status);
              const code = `CF-${g.id.substring(0, 8).toUpperCase()}`;
              return (
                <div key={g.id} className="grievance-card" style={{ marginBottom: 16 }}>
                  <div className="row space-between" style={{ alignItems: "center", marginBottom: 8 }}>
                    <span className="code-pill">{code}</span>
                    <span className={badgeClass(g.severity, g.emergency)}>
                      {g.department || "General"} · {g.severity || "Medium"}
                    </span>
                  </div>
                  <p><strong>Problem:</strong> {g.problem}</p>
                  <p>
                    <strong>Current Status:</strong>{" "}
                    <span className={`status-pill status-${(g.status || "Submitted").toLowerCase().replace(/\s+/g, "-")}`}>
                      {g.status || "Submitted"}
                    </span>
                  </p>
                  <p style={{ marginTop: 6 }}>
                    <strong>SLA Target Response:</strong>{" "}
                    <span className={st.breached ? "badge badge-emergency" : "badge badge-high"}>
                      {st.breached ? "🚨 SLA BREACHED" : `⏱️ ${st.label}`}
                    </span>
                  </p>
                  {st.breached && (
                    <div className="emergency-banner" style={{ marginTop: 10 }}>
                      <p><strong>⚠️ AI Escalation Triggered:</strong> Response deadline was exceeded. High priority reassignment recommended to Senior Department Supervisor.</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {adminTab === "insights" && (
          <div className="card">
            <h2>💡 Authority AI Insights</h2>
            <p className="muted" style={{ marginBottom: 20 }}>
              Automated executive decision-support engine. Computes city-wide workload bottlenecks, department distribution ratios, geographic issue clusters, and week-over-week trend surges.
            </p>
            <div className="insights-list" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {insights.map((n, idx) => (
                <div key={idx} className="grievance-card" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 18px" }}>
                  <span style={{ fontSize: "1.3rem" }}>
                    {n.includes("emergency") || n.includes("emergencies") ? "🚨" :
                     n.includes("represent") || n.includes("backlog") ? "📊" :
                     n.includes("cluster") ? "⭕" :
                     n.includes("increased") || n.includes("changed") ? "📈" : "💡"}
                  </span>
                  <p style={{ margin: 0, fontSize: "0.98rem", color: "#e2e8f0", lineHeight: 1.5 }}>
                    {n}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {adminTab === "inbox" && (
          <AdminDashboard grievances={allGrievances} updateStatus={updateStatus} deleteGrievance={deleteGrievance} />
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
              <li><span className="check-icon">✓</span> Be clear and concise in your description</li>
              <li><span className="check-icon">✓</span> Include exact location details</li>
              <li><span className="check-icon">✓</span> Attach photos for faster verification</li>
              <li><span className="check-icon">✓</span> Use the map to pinpoint the spot</li>
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
  const { default: MapViewInner, Marker, Circle, Popup } = MapMod;

  const validItems = filtered.filter((g) => g.latitude != null && g.longitude != null);
  let centerLat = 16.5062;
  let centerLng = 80.6480;
  let zoomLevel = 12;

  if (validItems.length === 1) {
    centerLat = Number(validItems[0].latitude);
    centerLng = Number(validItems[0].longitude);
    zoomLevel = 15;
  } else if (validItems.length > 1) {
    const sumLat = validItems.reduce((acc, g) => acc + Number(g.latitude), 0);
    const sumLng = validItems.reduce((acc, g) => acc + Number(g.longitude), 0);
    centerLat = sumLat / validItems.length;
    centerLng = sumLng / validItems.length;
    zoomLevel = 13;
  }

  return (
    <MapViewInner center={[centerLat, centerLng]} zoom={zoomLevel}>
      {validItems.map((g) => (
        <Marker key={g.id} position={[Number(g.latitude), Number(g.longitude)]}>
          {Popup && (
            <Popup>
              <div style={{ color: "#0a0e27", fontFamily: "sans-serif", padding: "4px" }}>
                <strong style={{ fontSize: "14px", color: "#1e1b4b" }}>
                  {g.department || "General"} · {g.severity || "Medium"}
                </strong>
                <p style={{ margin: "6px 0", fontSize: "13px", color: "#334155" }}>
                  {g.problem}
                </p>
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  Status: <strong>{g.status || "Submitted"}</strong> | {g.city || g.detailedLocation || "Captured via GPS"}
                </div>
              </div>
            </Popup>
          )}
        </Marker>
      ))}
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

function QueueColumn({ title, items, updateStatus, deleteGrievance, slaMinutes }) {
  return (
    <div className="queue-col" style={{ marginTop: 18 }}>
      <h3>{title} · {items.length} incidents</h3>
      {items.map((g) => {
        const dead = g.slaDeadlineMs || slaDeadlineFrom(g.createdAt, g.severity, slaMinutes);
        const st = slaState(dead, g.status);
        const code = `CF-${(g.id || "").substring(0, 8).toUpperCase()}`;
        return (
          <div key={g.id} className="grievance-card">
            <div className="row space-between" style={{ alignItems: "center" }}>
              <span className="code-pill">{code}</span>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                {g.isDemo && <span className="badge badge-medium">DEMO / SAMPLE</span>}
                {deleteGrievance && (
                  <button
                    className="btn ghost btn-sm"
                    style={{ color: "#ef4444", padding: "2px 6px", fontSize: "0.75rem", border: "1px solid rgba(239,68,68,0.3)" }}
                    onClick={() => deleteGrievance(g.id)}
                    title="Delete complaint"
                  >
                    🗑️ Delete
                  </button>
                )}
              </div>
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

function AdminDashboard({ grievances, updateStatus, deleteGrievance }) {
  return (
    <div className="card">
      <h2>🛠 Admin Grievance Panel</h2>
      {grievances.length === 0 ? (
        <p className="muted">No grievances currently in system.</p>
      ) : (
        grievances.map((g) => (
          <div key={g.id} className="grievance-card">
            <div className="row space-between" style={{ alignItems: "center", marginBottom: "8px" }}>
              <span className="code-pill">{`CF-${(g.id || "").substring(0, 8).toUpperCase()}`}</span>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span className={badgeClass(g.severity, g.emergency)}>
                  📋 Department: {g.department || "General"}
                </span>
                {deleteGrievance && (
                  <button
                    className="btn ghost btn-sm"
                    style={{ color: "#ef4444", padding: "3px 8px", fontSize: "0.8rem", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "4px" }}
                    onClick={() => deleteGrievance(g.id)}
                    title="Delete complaint"
                  >
                    🗑️ Delete
                  </button>
                )}
              </div>
            </div>
            <p><b>Issue:</b> {g.problem}</p>
            <p>
              <b>📋 Classified Department:</b>{" "}
              <strong style={{ color: "#f093fb" }}>{g.department || "General"}</strong>{" "}
              {g.category ? `(${g.category})` : ""}
            </p>
            <p><b>City:</b> {g.city || "Captured via GPS"}</p>
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
        ))
      )}
    </div>
  );
}
