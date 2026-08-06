import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, KeyRound, Mail, WalletCards } from "lucide-react";
import { useAuth } from "../../context/useAuth";
import { useToast } from "../../context/useToast";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, forgotPassword, configError } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = location.state?.from?.pathname || "/dashboard";

  useEffect(() => {
    if (location.state?.logoutSuccess) {
      showToast({ type: "success", message: "Logged out successfully." });
      navigate("/", { replace: true, state: {} });
    }
  }, [location.state, navigate, showToast]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      await login(email, password);
      showToast({ type: "success", message: "Login successful." });
      navigate(redirectTo, { replace: true, state: { loginSuccess: true } });
    } catch (error) {
      const message = getFirebaseErrorMessage(error, "Invalid email or password. Please try again.");
      setError(message);
      showToast({ type: "error", message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError("Enter your email first, then click Forgot Password.");
      setMessage("");
      return;
    }

    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      await forgotPassword(email);
      setMessage("Password reset email sent. Please check your inbox.");
      showToast({ type: "success", message: "Password reset email sent." });
    } catch (error) {
      const message = getFirebaseErrorMessage(
        error,
        "We couldn't send a reset email. Please verify the email address.",
      );
      setError(message);
      showToast({ type: "error", message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center justify-center">
        <section className="w-full rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/30 sm:p-8">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-500 p-3 text-slate-950">
              <WalletCards size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Digital Ledger</h1>
              <p className="text-sm text-slate-400">Store owner login</p>
            </div>
          </div>

          {configError && (
            <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Firebase setup is incomplete.
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">
                Email
              </span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3">
                <Mail size={18} className="text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@email.com"
                  className="w-full bg-transparent text-white outline-none placeholder:text-slate-500"
                  required
                  autoComplete="email"
                  disabled={Boolean(configError)}
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">
                Password
              </span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3">
                <KeyRound size={18} className="text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  className="w-full bg-transparent text-white outline-none placeholder:text-slate-500"
                  required
                  autoComplete="current-password"
                  disabled={Boolean(configError)}
                />
              </div>
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-sm font-medium text-cyan-300 transition hover:text-cyan-200"
                disabled={submitting || Boolean(configError)}
              >
                Forgot password?
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {message && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || Boolean(configError)}
              className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-base font-semibold text-slate-950 transition hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? "Signing in..." : "Login"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

export default Login;
