import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
import { auth, firebaseConfigError } from "../firebase/firebase";
import AuthContext from "./AuthContextObject";

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!firebaseConfigError);

  useEffect(() => {
    if (!auth) {
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      configError: firebaseConfigError,
      login: (email, password) =>
        auth
          ? signInWithEmailAndPassword(auth, email, password)
          : Promise.reject(new Error(firebaseConfigError)),
      logout: () =>
        auth ? signOut(auth) : Promise.reject(new Error(firebaseConfigError)),
      forgotPassword: (email) =>
        auth
          ? sendPasswordResetEmail(auth, email)
          : Promise.reject(new Error(firebaseConfigError)),
      changePassword: async (currentPassword, newPassword) => {
        if (!auth?.currentUser) {
          throw new Error("You must be logged in to change the password.");
        }

        const credential = EmailAuthProvider.credential(
          auth.currentUser.email || "",
          currentPassword,
        );

        await reauthenticateWithCredential(auth.currentUser, credential);
        await updatePassword(auth.currentUser, newPassword);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthProvider };
