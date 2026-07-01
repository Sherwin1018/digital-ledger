import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db, firebaseConfigError } from "../firebase/firebase";

const SETTINGS_COLLECTION = "settings";
const ADMIN_PROFILE_DOCUMENT = "adminProfile";

function ensureFirestore() {
  if (!db) {
    throw new Error(
      firebaseConfigError || "Firestore is unavailable because Firebase is not configured.",
    );
  }
}

function getDefaultAdminProfile(user) {
  return {
    fullName: user?.displayName || "Admin",
    email: user?.email || "",
    photoDataUrl: "",
    updatedAt: null,
  };
}

async function getAdminProfile(user) {
  ensureFirestore();

  const profileRef = doc(db, SETTINGS_COLLECTION, ADMIN_PROFILE_DOCUMENT);
  const snapshot = await getDoc(profileRef);

  if (!snapshot.exists()) {
    return getDefaultAdminProfile(user);
  }

  const data = snapshot.data();

  return {
    fullName: data.fullName || user?.displayName || "Admin",
    email: data.email || user?.email || "",
    photoDataUrl: data.photoDataUrl || "",
    updatedAt: data.updatedAt || null,
  };
}

async function saveAdminProfile(profile, user) {
  ensureFirestore();

  const profileRef = doc(db, SETTINGS_COLLECTION, ADMIN_PROFILE_DOCUMENT);

  await setDoc(
    profileRef,
    {
      fullName: profile.fullName.trim() || "Admin",
      email: user?.email || profile.email || "",
      photoDataUrl: profile.photoDataUrl || "",
      updatedAt: serverTimestamp(),
      updatedBy: user?.uid || "",
    },
    { merge: true },
  );
}

export { getAdminProfile, saveAdminProfile };
