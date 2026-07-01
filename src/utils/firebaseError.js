function getFirebaseErrorCode(error) {
  return typeof error?.code === "string" ? error.code : "";
}

function getFirebaseErrorMessage(error, fallbackMessage) {
  const code = getFirebaseErrorCode(error);
  const rawMessage = typeof error?.message === "string" ? error.message : "";

  if (code === "permission-denied" || rawMessage.includes("Missing or insufficient permissions")) {
    return "Firestore access is blocked by your Firebase rules. In Firebase Console > Firestore Database > Rules, allow your signed-in admin account to read and write documents, then publish the rules.";
  }

  if (code === "unavailable") {
    return "Firebase is temporarily unavailable. Please check your internet connection and try again.";
  }

  if (code === "failed-precondition") {
    return "A required Firestore index or setup step is missing. Please finish the Firebase setup, then try again.";
  }

  if (code === "auth/requires-recent-login") {
    return "For security, Firebase needs you to log in again before changing the password.";
  }

  if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "The current password is incorrect.";
  }

  if (code === "auth/weak-password") {
    return "The new password is too weak. Use at least 6 characters.";
  }

  return rawMessage || fallbackMessage;
}

export { getFirebaseErrorMessage };
