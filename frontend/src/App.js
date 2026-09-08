import { auth } from "./firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  orderBy   // ✅ ADD THIS (make sure it is added only once)
} from "firebase/firestore";


function LocationPicker({ setCoords }) {
  useMapEvents({
    click(e) {
      setCoords({
        lat: e.latlng.lat,
        lng: e.latlng.lng,
      });
    },
  });
  return null;
}

export default function App() {
  const [page, setPage] = useState(1);

  const [problem, setProblem] = useState("");
 const [city, setCity] = useState("");
  const [aiData, setAiData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [coords, setCoords] = useState(null);
  const [detailedLocation, setDetailedLocation] = useState("");
  const [image, setImage] = useState(null);
  const [mailBody, setMailBody] = useState("");

  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  
  const [authMode, setAuthMode] = useState("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  const [grievances, setGrievances] = useState([]);
  const [allGrievances, setAllGrievances] = useState([]);

  const ADMIN_EMAILS = ["admin@grievancenet.com"];

  const [isAdmin, setIsAdmin] = useState(false);


 useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
    setUser(currentUser);
    if (currentUser) {
      setPage(0); // ✅ Go to dashboard after login
    }

    if (currentUser && currentUser.email === "admin@grievancenet.com") {
      setIsAdmin(true);
    } else {
      setIsAdmin(false);
    }
  });

  return () => unsubscribe();
}, []);

  useEffect(() => {
  if (!user) return;

  const q = query(
    collection(db, "grievances"),
    where("userId", "==", user.uid)
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    setGrievances(list);
  });
 return () => unsubscribe();
}, [user]);


 useEffect(() => {
  if (!isAdmin) return;

  const q = query(
    collection(db, "grievances"),
    orderBy("createdAt", "desc") // latest first
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    setAllGrievances(
      snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
    );
  });

  return () => unsubscribe();
}, [isAdmin]);

   const login = async () => {
  if (!email || !password) {
    setAuthError("Email and password are required");
    return;
  }

  if (!email.includes("@")) {
    setAuthError("Please enter a valid email address");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
    setAuthError("");
  } catch (err) {
    setAuthError(err.message);
  }
};


const updateStatus = async (id, newStatus) => {
  try {
    await updateDoc(doc(db, "grievances", id), {
      status: newStatus,
    });
  } catch (err) {
    alert("Failed to update status");
  }
};


const register = async () => {
  if (!email || !password || !name) {
    setAuthError("All fields are required");
    return;
  }

  if (!email.includes("@")) {
    setAuthError("Please enter a valid email");
    return;
  }

  if (password.length < 6) {
    setAuthError("Password must be at least 6 characters");
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, email.trim(), password);

    await signOut(auth); // force logout
    
    // ✅ CLEAR INPUT FIELDS
    setEmail("");
    setPassword("");
    setName("");
    setPhone("");

    // ✅ SWITCH TO LOGIN MODE
    setAuthMode("login");
    setAuthError("✅ Registered successfully! Please login.");
  
  } catch (err) {
    setAuthError(err.message);
  }
};


  const logout = async () => {
    await signOut(auth);
    setPage(1);
    setProblem("");
    setAiData(null);
    setMailBody("");
    setCoords(null);
    setDetailedLocation("");
  };


  // ---------------- AI CALL ----------------
  const generateMail = async () => {
    if (!problem.trim()) {
      alert("Please describe your problem first");
      return;
    }

    setLoading(true);
    setAiData(null);

    try {
      const res = await fetch("http://localhost:5000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: problem, location: city }),
      });

      const data = await res.json();
      setAiData(data);
      setMailBody(data.draftedMail || "");
    } catch {
      alert("Backend not reachable");
    }

    setLoading(false);
  };

  // ---------------- LOCATION ----------------
  const getCurrentLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      () => alert("Location permission denied")
    );
  };

  // ---------------- SEND EMAIL ----------------
 const sendEmail = async () => {
  try {
    const formData = new FormData();
    formData.append("body", mailBody);
    formData.append("detailed_location", detailedLocation);
    formData.append("latitude", coords?.lat || "");
    formData.append("longitude", coords?.lng || "");
    if (image) formData.append("image", image);

    const res = await fetch("http://localhost:5000/send-email", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    // ✅ CHECK HTTP STATUS, NOT data.status
    if (res.ok) {
      // ✅ SAVE TO FIRESTORE
      await addDoc(collection(db, "grievances"), {
        userId: user.uid,
        problem: problem,
        city: city,
        mailBody: mailBody,
        detailedLocation: detailedLocation,
        latitude: coords?.lat || "",
        longitude: coords?.lng || "",
        status: "Pending",
        createdAt: serverTimestamp(),
      });

      alert("✅ Grievance submitted successfully");
      setPage(3); // Go to Status page
    } else {
      alert(data.error || "❌ Mail failed");
    }
  } catch (err) {
    console.error(err);
    alert("❌ Error submitting grievance");
  }
};




function AdminDashboard({ grievances }) {
  const updateStatus = async (id, newStatus) => {
    await updateDoc(doc(db, "grievances", id), {
      status: newStatus,
    });
    alert("Status updated");
  };

  return (
    <div className="card">
      <h2>🛠 Admin Grievance Panel</h2>

      {grievances.map((g) => (
        <div key={g.id} style={{ borderBottom: "1px solid #eee", padding: 10 }}>
          <p><b>Issue:</b> {g.problem}</p>
          <p><b>City:</b> {g.city}</p>
          <p style={{ fontSize: 13, color: "#64748b" }}>
      <b>Submitted:</b>{" "}
      {g.createdAt?.toDate
        ? g.createdAt.toDate().toLocaleString()
        : "Just now"}
    </p>
          {g.latitude && g.longitude && (
            <p>
              <b>📍 Location:</b> {g.latitude}, {g.longitude}
            </p>
          )}

            {g.detailedLocation && (
              <p>
                <b>🏷 Landmark:</b> {g.detailedLocation}
              </p>
            )}

          <div className="status-row">
  <span className="status-label">Status:</span>

  <select
    className={`status-select ${
      g.status === "Resolved"
        ? "status-resolved"
        : g.status === "In Progress"
        ? "status-processing"
        : g.status === "Rejected"
        ? "status-rejected"
        : "status-pending"
    }`}
    value={g.status}
    onChange={(e) => updateStatus(g.id, e.target.value)}
  >
    <option value="Pending">Pending</option>
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


   // ================= LOGIN UI =================
  if (!user) {
  return (
    <div style={{ maxWidth: 420, margin: "80px auto" }} className="card">
      {authMode === "login" && (
        <>
          <h2 style={{ textAlign: "center" }}>🔐 GrievanceNet Login</h2>

          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <br /><br />

          <div style={{ position: "relative" }}>
          <input
            className="input"
            type={showLoginPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <span
            onClick={() => setShowLoginPassword(!showLoginPassword)}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              cursor: "pointer",
              fontSize: 18,
              color: "#64748b",
            }}
          >
            {showLoginPassword ? "🙈" : "👁️"}
          </span>
        </div>


          <br /><br />

          <button className="btn primary" onClick={login} style={{ width: "100%" }}>
            Login
          </button>

          <p style={{ textAlign: "center", marginTop: 12 }}>
            New user?{" "}
            <span
              style={{ color: "#5b21b6", cursor: "pointer", fontWeight: 600 }}
              onClick={() => setAuthMode("register")}
            >
              Register here
            </span>
          </p>
        </>
      )}

      {authMode === "register" && (
        <>
          <h2 style={{ textAlign: "center" }}>📝 Register</h2>

          <input
            className="input"
            placeholder="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <br /><br />

          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <br /><br />

          <input
            className="input"
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <br /><br />

         <div style={{ position: "relative" }}>
          <input
            className="input"
            type={showRegisterPassword ? "text" : "password"}
            placeholder="Password (min 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <span
            onClick={() => setShowRegisterPassword(!showRegisterPassword)}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              cursor: "pointer",
              fontSize: 18,
              color: "#64748b",
            }}
          >
            {showRegisterPassword ? "🙈" : "👁️"}
          </span>
        </div>


          <br /><br />

          <button className="btn primary" onClick={register} style={{ width: "100%" }}>
            Register
          </button>

          <p style={{ textAlign: "center", marginTop: 12 }}>
            Already registered?{" "}
            <span
              style={{ color: "#5b21b6", cursor: "pointer", fontWeight: 600 }}
              onClick={() => setAuthMode("login")}
            >
              Login
            </span>
          </p>
        </>
      )}

      {authError && (
        <p
          style={{
            marginTop: 12,
            textAlign: "center",
            color: authError.includes("successfully") ? "green" : "red",
            fontWeight: 600,
          }}
        >
          {authError}
        </p>
      )}
    </div>
  );
}


// ================= ADMIN VIEW =================
if (isAdmin) {
  return (
    <div className="app-container">
      <header className="hero">
        <h1>🛡 GrievanceNet Admin Panel</h1>
        <button className="btn ghost" onClick={logout}>Logout</button>
      </header>

      <AdminDashboard grievances={allGrievances} />
    </div>
  );
}


  // ================= MAIN APP =================
  return (
    <div className="app-container">
      <header className="hero">
        <div className="hero-inner">
          <h1>📢 AI Grievance Assistant</h1>
          <p className="tagline">Report civic issues in plain language — AI helps route and draft clear grievance mails.</p>
        </div>
         <button
          className="btn ghost"
          style={{ marginLeft: "auto" }}
          onClick={logout}
        >
          Logout
        </button>
      </header>

      <main className="content">
        <div className="card">
          {page === 0 && (
  <div className="form">
    <h2>👋 Welcome to GrievanceNet</h2>
    <p className="muted">
      Track your submitted complaints or raise a new grievance.
    </p>

    <div className="actions" style={{ marginTop: 20 }}>
      <button
        className="btn primary"
        onClick={() => setPage(3)}
      >
        📊 View My Complaints
      </button>

      <button
        className="btn secondary"
        onClick={() => setPage(1)}
      >
        ➕ Raise New Complaint
      </button>
    </div>
  </div>
)}


          {page === 1 && (
            <div className="form">
              <label className="label">Describe your problem</label>
              <textarea
                rows="5"
                className="input textarea"
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="E.g., Streetlight not working near my house, garbage piling up..."
              />

              <label className="label">City / Area</label>
              <input
                type="text"
                className="input"
                placeholder="Enter your city or area (e.g., Benz Circle, MG Road)"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />


              <div className="actions">
                <button className="btn primary" onClick={generateMail} disabled={loading}>
                  {loading ? "Analyzing…" : "🤖 Analyze with Gemini"}
                </button>

                {aiData && (
                  <button className="btn secondary" onClick={() => setPage(2)}>Proceed →</button>
                )}
              </div>

              {aiData && (
                <div className="ai-preview">
                  <h3>Draft Mail</h3>
                  <textarea className="input textarea" rows={6} value={mailBody} readOnly />
                </div>
              )}
            </div>
          )}

          {page === 2 && (
            <div className="form">
              <div className="row space-between">
                <button className="btn" onClick={getCurrentLocation}>Use Current Location</button>
                <button className="btn ghost" onClick={() => setPage(1)}>← Back</button>
              </div>

              {coords && (
                <p className="muted">Lat: {coords.lat} | Lng: {coords.lng}</p>
              )}

              <div className="map-wrap">
                <MapContainer
                  center={[16.5062, 80.648]}
                  zoom={13}
                  className="map"
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <LocationPicker setCoords={setCoords} />
                  {coords && <Marker position={[coords.lat, coords.lng]} />}
                </MapContainer>
              </div>

              <label className="label">Detailed location</label>
              <textarea
                rows="2"
                className="input textarea"
                placeholder="E.g., Near ABC Hospital, 2nd cross street"
                value={detailedLocation}
                onChange={(e) => setDetailedLocation(e.target.value)}
              />

              <label className="label">Mail body</label>
              <textarea
                rows="6"
                className="input textarea"
                value={mailBody}
                onChange={(e) => setMailBody(e.target.value)}
              />

              <label className="label">Attach photo (optional)</label>
              <input className="input file" type="file" onChange={(e) => setImage(e.target.files[0])} />

              <div className="actions">
                <button className="btn primary" onClick={sendEmail}>📤 Send Grievance Mail</button>
              </div>
            </div>
          )}


          {page === 3 && (
  <div className="form">
    <h2>📊 Grievance Status</h2>

    {grievances.length === 0 && (
      <p className="muted">No grievances submitted yet.</p>
    )}

    {grievances.map((g) => (
      <div key={g.id} className="card small" style={{ marginBottom: 12 }}>
        <p><strong>Problem:</strong> {g.problem}</p>
        <p><strong>City:</strong> {g.city}</p>
        <p>
          <strong>Status:</strong>{" "}
          <span
            style={{
              color:
                g.status === "Resolved"
                  ? "green"
                  : g.status === "Processing"
                  ? "orange"
                  : "red",
            }}
          >
            {g.status}
          </span>
        </p>
      </div>
    ))}

    <button className="btn ghost" onClick={() => setPage(0)}>
      ← Back to Submitted Complaints
    </button>
  </div>
)}

        </div>

        <aside className="sidebar">
          <div className="card small">
            <h4>Tips</h4>
            <ul>
              <li>Be concise and include the exact location.</li>
              <li>Attach a photo for faster verification.</li>
              <li>Use the map to mark the precise spot.</li>
            </ul>
          </div>

          <div className="card small">
            <h4>Support</h4>
            <p className="muted">This demo uses Gemini (free-tier) to analyze messages. No data is sent without your action.</p>
          </div>
        </aside>
      </main>

      

      <div className={`loading-overlay ${loading ? 'visible' : ''}`}>Analyzing…</div>
    </div>
  );
}
