import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// 🔥 Firebase Config (PASTE YOUR VALUES)
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyCDFUc8TFbhnSlL5l1wgocwWCE6xxN4yl8",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "civicflow-ai-b2144.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "civicflow-ai-b2144",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "civicflow-ai-b2144.appspot.com",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "1028711488185",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:1028711488185:web:5eb04b4074ef9b49b38ed3",
};

const app = initializeApp(firebaseConfig);

// Export auth
export const auth = getAuth(app);

// 🗄️ Firestore Database
export const db = getFirestore(app);

// Firebase Storage
export const storage = getStorage(app);