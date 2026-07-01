import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, KeyRound, Mail, WalletCards } from "lucide-react";
import { useAuth } from "../../context/useAuth";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, forgotPassword, configError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = location.state?.from?.pathname || "/dashboard";

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      await login(email, password);
      navigate(redirectTo, { replace: true, state: { loginSuccess: true } });
    } catch (error) {
      setError(getFirebaseErrorMessage(error, "Invalid email or password. Please try again."));
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
    } catch (error) {
      setError(
        getFirebaseErrorMessage(
          error,
          "We couldn't send a reset email. Please verify the email address.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_60%)] px-4 py-10 text-white">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <section className="space-y-6">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur">
            <WalletCards size={18} />
            Digital Ledger Admin
          </div>

          <div className="space-y-4">
            <h1 className="max-w-xl text-4xl font-black leading-tight sm:text-5xl">
              Secure admin access for your ledger workspace.
            </h1>

            <p className="max-w-lg text-base text-slate-300 sm:text-lg">
              Sign in with your admin email and password to manage customers, debts,
              payments, reports, and settings.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur sm:p-8">
          <div className="mb-8">
            <h2 className="text-3xl font-bold">Login</h2>
            <p className="mt-2 text-sm text-slate-400">
              Use the single admin account connected to Firebase Authentication.
            </p>
          </div>

          {configError && (
            <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Firebase is not configured yet. Create `.env.local` from `.env.example`,
              paste your Firebase keys, and restart the dev server.
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Email</span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3">
                <Mail size={18} className="text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@email.com"
                  className="w-full bg-transparent text-white outline-none placeholder:text-slate-500"
                  autoComplete="email"
                  disabled={Boolean(configError)}
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Password</span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900 px-4 py-3">
                <KeyRound size={18} className="text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  className="w-full bg-transparent text-white outline-none placeholder:text-slate-500"
                  autoComplete="current-password"
                  disabled={Boolean(configError)}
                />
              </div>
            </label>

            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-sm font-medium text-cyan-300 transition hover:text-cyan-200"
                disabled={submitting || Boolean(configError)}
              >
                Forgot Password
              </button>

              <span className="text-xs text-slate-500">Admin only</span>
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
              className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-base font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? "Please wait..." : "Login"}
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-500">
            After login, you&apos;ll be redirected to the dashboard and protected pages.
          </p>
        </section>
      </div>
    </div>
  );
}

export default Login;
