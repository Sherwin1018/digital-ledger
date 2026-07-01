import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Mail, Save, UserCircle, UserRound, X } from "lucide-react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { useAuth } from "../../context/useAuth";
import { firebaseConfigError } from "../../firebase/firebase";
import { getAdminProfile, saveAdminProfile } from "../../services/profileService";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

const emptyForm = {
  fullName: "",
  email: "",
  photoDataUrl: "",
};

function formatDate(timestamp) {
  if (!timestamp) {
    return "Not updated yet";
  }

  const date =
    typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "Not updated yet";
  }

  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function validateProfileForm(form) {
  const errors = {};

  if (!form.fullName.trim()) {
    errors.fullName = "Full name is required.";
  }

  return errors;
}

function Profile() {
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [pageError, setPageError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setPageError("");

    try {
      const profile = await getAdminProfile(user);
      setForm({
        fullName: profile.fullName || user?.displayName || "Admin",
        email: profile.email || user?.email || "",
        photoDataUrl: profile.photoDataUrl || "",
      });
      setUpdatedAt(profile.updatedAt || null);
    } catch (error) {
      setPageError(getFirebaseErrorMessage(error, "Failed to load profile."));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (firebaseConfigError || !user) {
      return;
    }

    const timer = window.setTimeout(loadProfile, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile, user]);

  function handlePickPhoto() {
    fileInputRef.current?.click();
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setPageError("Please choose an image file for the profile photo.");
      return;
    }

    if (file.size > 1024 * 1024 * 2) {
      setPageError("Please choose an image smaller than 2MB.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setForm((current) => ({
        ...current,
        photoDataUrl: typeof reader.result === "string" ? reader.result : "",
      }));
      setPageError("");
    };

    reader.readAsDataURL(file);
  }

  function handleRemovePhoto() {
    setForm((current) => ({
      ...current,
      photoDataUrl: "",
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const nextErrors = validateProfileForm(form);
    setErrors(nextErrors);
    setMessage("");
    setPageError("");

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSaving(true);

    try {
      await saveAdminProfile(form, user);
      setMessage("Profile updated successfully.");
      await loadProfile();
      window.dispatchEvent(new Event("admin-profile-updated"));
    } catch (error) {
      setPageError(getFirebaseErrorMessage(error, "Unable to save profile."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
          <UserRound size={16} className="text-cyan-700" />
          <span>Last update: {formatDate(updatedAt)}</span>
        </div>

        {firebaseConfigError && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Firebase is not configured yet. Create `.env.local`, add your Firebase
            values, and restart the dev server before using the profile page.
          </div>
        )}

        {pageError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {pageError}
          </div>
        )}

        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <article className="rounded-3xl bg-white p-6 shadow-md">
            <h3 className="text-xl font-bold text-slate-900">Profile Photo</h3>
            <p className="mt-2 text-sm text-slate-500">
              Choose the photo that appears beside the notification bell.
            </p>

            <div className="mt-6 flex flex-col items-center rounded-3xl bg-slate-50 px-6 py-8">
              {form.photoDataUrl ? (
                <img
                  src={form.photoDataUrl}
                  alt="Admin profile preview"
                  className="h-36 w-36 rounded-full border-4 border-white object-cover shadow-lg"
                />
              ) : (
                <UserCircle size={136} className="text-slate-300" />
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handlePickPhoto}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400"
                >
                  <Camera size={18} />
                  Choose Photo
                </button>

                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  disabled={!form.photoDataUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-5 py-3 font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X size={18} />
                  Remove
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </div>
          </article>

          <article className="rounded-3xl bg-white p-6 shadow-md">
            <h3 className="text-xl font-bold text-slate-900">Admin Details</h3>
            <p className="mt-2 text-sm text-slate-500">
              Your email stays hidden in the topbar and appears only on hover.
            </p>

            {loading ? (
              <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Loading profile...
              </div>
            ) : (
              <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Full Name
                  </span>
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        fullName: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                  />
                  {errors.fullName && (
                    <p className="mt-2 text-sm text-red-600">{errors.fullName}</p>
                  )}
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600">
                    <Mail size={18} />
                    <span className="text-sm">{form.email || user?.email || "No email found"}</span>
                  </div>
                </label>

                {message && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {message}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving || Boolean(firebaseConfigError)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <Save size={18} />
                    {saving ? "Saving..." : "Save Profile"}
                  </button>
                </div>
              </form>
            )}
          </article>
        </section>
      </div>
    </DashboardLayout>
  );
}

export default Profile;
