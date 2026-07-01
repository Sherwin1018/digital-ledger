import { useEffect, useRef, useState } from "react";
import {
  DatabaseBackup,
  Download,
  Info,
  KeyRound,
  Settings2,
  Store,
  Upload,
  X,
} from "lucide-react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { useAuth } from "../../context/AuthContext";
import { firebaseConfigError } from "../../firebase/firebase";
import {
  createBackupSnapshot,
  getStoreSettings,
  normalizeContactNumber,
  restoreBackupSnapshot,
  saveStoreSettings,
} from "../../services/settingsService";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

const emptyStoreForm = {
  storeName: "",
  storeAddress: "",
  contactNumber: "",
};

const emptyPasswordForm = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
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

function validateStoreForm(form) {
  const errors = {};
  const normalizedContact = normalizeContactNumber(form.contactNumber);

  if (!form.storeName.trim()) {
    errors.storeName = "Store name is required.";
  }

  if (!form.storeAddress.trim()) {
    errors.storeAddress = "Store address is required.";
  }

  if (!normalizedContact) {
    errors.contactNumber = "Contact number is required.";
  } else if (!/^\+?\d{10,15}$/.test(normalizedContact)) {
    errors.contactNumber = "Contact number must be 10 to 15 digits.";
  }

  return errors;
}

function validatePasswordForm(form) {
  const errors = {};

  if (!form.currentPassword) {
    errors.currentPassword = "Current password is required.";
  }

  if (!form.newPassword) {
    errors.newPassword = "New password is required.";
  } else if (form.newPassword.length < 6) {
    errors.newPassword = "New password must be at least 6 characters.";
  }

  if (!form.confirmPassword) {
    errors.confirmPassword = "Please confirm the new password.";
  } else if (form.newPassword !== form.confirmPassword) {
    errors.confirmPassword = "The new passwords do not match.";
  }

  return errors;
}

function Settings() {
  const { user, changePassword } = useAuth();
  const restoreInputRef = useRef(null);
  const [storeForm, setStoreForm] = useState(emptyStoreForm);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [storeErrors, setStoreErrors] = useState({});
  const [passwordErrors, setPasswordErrors] = useState({});
  const [pageError, setPageError] = useState("");
  const [storeMessage, setStoreMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [savingStore, setSavingStore] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restorePayload, setRestorePayload] = useState(null);
  const [restoreFileName, setRestoreFileName] = useState("");

  useEffect(() => {
    if (firebaseConfigError) {
      setLoading(false);
      return;
    }

    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setPageError("");

    try {
      const settings = await getStoreSettings();
      setStoreForm({
        storeName: settings.storeName || "",
        storeAddress: settings.storeAddress || "",
        contactNumber: settings.contactNumber || "",
      });
      setUpdatedAt(settings.updatedAt || null);
    } catch (error) {
      setPageError(getFirebaseErrorMessage(error, "Failed to load settings."));
    } finally {
      setLoading(false);
    }
  }

  async function handleStoreSubmit(event) {
    event.preventDefault();

    const nextErrors = validateStoreForm(storeForm);
    setStoreErrors(nextErrors);
    setStoreMessage("");
    setPageError("");

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSavingStore(true);

    try {
      await saveStoreSettings(storeForm, user);
      await loadSettings();
      setStoreMessage("Store settings saved successfully.");
    } catch (error) {
      setPageError(getFirebaseErrorMessage(error, "Unable to save store settings."));
    } finally {
      setSavingStore(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();

    const nextErrors = validatePasswordForm(passwordForm);
    setPasswordErrors(nextErrors);
    setPasswordMessage("");
    setPageError("");

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSavingPassword(true);

    try {
      await changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      setPasswordForm(emptyPasswordForm);
      setPasswordMessage("Password changed successfully.");
    } catch (error) {
      setPageError(getFirebaseErrorMessage(error, "Unable to change password."));
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleBackupDownload() {
    setBackingUp(true);
    setBackupMessage("");
    setPageError("");

    try {
      const snapshot = await createBackupSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");

      link.href = url;
      link.download = `digital-ledger-backup-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setBackupMessage("Backup downloaded successfully.");
    } catch (error) {
      setPageError(getFirebaseErrorMessage(error, "Unable to create backup."));
    } finally {
      setBackingUp(false);
    }
  }

  function handleRestorePicker() {
    restoreInputRef.current?.click();
  }

  function closeRestoreModal() {
    setRestoreModalOpen(false);
    setRestorePayload(null);
    setRestoreFileName("");
  }

  async function handleRestoreFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setRestorePayload(parsed);
      setRestoreFileName(file.name);
      setBackupMessage("");
      setPageError("");
      setRestoreModalOpen(true);
    } catch {
      setPageError("The selected file is not a valid Digital Ledger backup JSON file.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleRestoreConfirm() {
    if (!restorePayload) {
      return;
    }

    setRestoring(true);
    setBackupMessage("");
    setPageError("");

    try {
      await restoreBackupSnapshot(restorePayload);
      await loadSettings();
      closeRestoreModal();
      window.dispatchEvent(new Event("admin-profile-updated"));
      setBackupMessage("Backup restored successfully.");
    } catch (error) {
      setPageError(getFirebaseErrorMessage(error, "Unable to restore backup."));
      setRestoring(false);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
          <Settings2 size={16} className="text-cyan-700" />
          <span>Last store update: {formatDate(updatedAt)}</span>
        </div>

        {firebaseConfigError && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Firebase is not configured yet. Create `.env.local`, add your Firebase
            values, and restart the dev server before using settings.
          </div>
        )}

        {pageError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {pageError}
          </div>
        )}

        {backupMessage && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {backupMessage}
          </div>
        )}

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="flex h-full flex-col rounded-3xl bg-white p-6 shadow-md">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                <Store size={20} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Store Information</h3>
                <p className="text-sm text-slate-500">
                  Update the business details used across the system.
                </p>
              </div>
            </div>

            <form className="mt-6 flex flex-1 flex-col space-y-5" onSubmit={handleStoreSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Store Name
                </span>
                <input
                  type="text"
                  value={storeForm.storeName}
                  onChange={(event) =>
                    setStoreForm((current) => ({
                      ...current,
                      storeName: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                />
                {storeErrors.storeName && (
                  <p className="mt-2 text-sm text-red-600">{storeErrors.storeName}</p>
                )}
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Store Address
                </span>
                <textarea
                  value={storeForm.storeAddress}
                  onChange={(event) =>
                    setStoreForm((current) => ({
                      ...current,
                      storeAddress: event.target.value,
                    }))
                  }
                  rows="5"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                />
                {storeErrors.storeAddress && (
                  <p className="mt-2 text-sm text-red-600">{storeErrors.storeAddress}</p>
                )}
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Contact Number
                </span>
                <input
                  type="text"
                  value={storeForm.contactNumber}
                  onChange={(event) =>
                    setStoreForm((current) => ({
                      ...current,
                      contactNumber: event.target.value,
                    }))
                  }
                  placeholder="09XXXXXXXXX or +639XXXXXXXXX"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                />
                {storeErrors.contactNumber && (
                  <p className="mt-2 text-sm text-red-600">{storeErrors.contactNumber}</p>
                )}
              </label>

              {storeMessage && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {storeMessage}
                </div>
              )}

              <div className="mt-auto flex justify-end">
                <button
                  type="submit"
                  disabled={savingStore || Boolean(firebaseConfigError) || loading}
                  className="rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {savingStore ? "Saving..." : "Save Store Settings"}
                </button>
              </div>
            </form>
          </article>

          <article className="flex h-full flex-col rounded-3xl bg-white p-6 shadow-md">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-violet-100 p-3 text-violet-700">
                <KeyRound size={20} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Change Password</h3>
                <p className="text-sm text-slate-500">
                  Update the single admin password securely.
                </p>
              </div>
            </div>

            <form className="mt-6 flex flex-1 flex-col space-y-5" onSubmit={handlePasswordSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Current Password
                </span>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                />
                {passwordErrors.currentPassword && (
                  <p className="mt-2 text-sm text-red-600">
                    {passwordErrors.currentPassword}
                  </p>
                )}
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  New Password
                </span>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      newPassword: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                />
                {passwordErrors.newPassword && (
                  <p className="mt-2 text-sm text-red-600">{passwordErrors.newPassword}</p>
                )}
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Confirm New Password
                </span>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                />
                {passwordErrors.confirmPassword && (
                  <p className="mt-2 text-sm text-red-600">
                    {passwordErrors.confirmPassword}
                  </p>
                )}
              </label>

              <div className="mt-auto space-y-4">
                {passwordMessage && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {passwordMessage}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingPassword || Boolean(firebaseConfigError)}
                    className="rounded-2xl bg-slate-900 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {savingPassword ? "Updating..." : "Change Password"}
                  </button>
                </div>
              </div>
            </form>
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="flex h-full flex-col rounded-3xl bg-white p-6 shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                  <Download size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Backup</h3>
                  <p className="text-sm text-slate-500">
                    Download a full ledger snapshot as a JSON file.
                  </p>
                </div>
              </div>

              <div className="group relative">
                <button
                  type="button"
                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Backup notes"
                >
                  <Info size={18} />
                </button>
                <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-80 rounded-2xl bg-slate-900 p-4 text-sm text-white opacity-0 shadow-2xl transition group-hover:opacity-100">
                  <p className="font-semibold">Backup Notes</p>
                  <p className="mt-2 text-slate-300">
                    Backups include `customers`, `debts`, `payments`,
                    `storeProfile`, and `adminProfile`.
                  </p>
                  <p className="mt-2 text-slate-300">
                    Restore replaces current data with the contents of the selected
                    backup file.
                  </p>
                  <p className="mt-2 text-slate-300">
                    Use only backup files generated by this Digital Ledger system.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-1 flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-900">Create a Backup File</p>
              <p className="mt-2 text-sm text-slate-500">
                Download customers, debts, payments, store settings, and admin
                profile into one restore-ready JSON file.
              </p>
              <div className="mt-auto pt-6">
                <button
                  type="button"
                  onClick={handleBackupDownload}
                  disabled={backingUp || Boolean(firebaseConfigError)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <Download size={18} />
                  {backingUp ? "Creating Backup..." : "Download Backup"}
                </button>
              </div>
            </div>
          </article>

          <article className="flex h-full flex-col rounded-3xl bg-white p-6 shadow-md">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                <Upload size={20} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Restore</h3>
                <p className="text-sm text-slate-500">
                  Import a previous backup and replace the current system data.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-1 flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-900">Restore From Backup File</p>
              <p className="mt-2 text-sm text-slate-500">
                Choose a previously downloaded Digital Ledger backup JSON file to
                restore customers, debts, payments, and settings.
              </p>
              <div className="mt-auto pt-6">
                <button
                  type="button"
                  onClick={handleRestorePicker}
                  disabled={restoring || Boolean(firebaseConfigError)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <Upload size={18} />
                  Choose Backup File
                </button>
              </div>
              <input
                ref={restoreInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleRestoreFileChange}
                className="hidden"
              />
            </div>
          </article>
        </section>
      </div>

      {restoreModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="my-6 flex w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Confirm Restore</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Restoring will replace the current ledger data.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeRestoreModal}
                  className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close restore confirmation modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-5 p-6">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  You are about to restore from{" "}
                  <span className="font-semibold">{restoreFileName || "selected backup file"}</span>.
                  This will overwrite the current customers, debts, payments, and
                  settings data.
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeRestoreModal}
                    disabled={restoring}
                    className="rounded-2xl border border-slate-200 px-5 py-3 font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRestoreConfirm}
                    disabled={restoring}
                    className="rounded-2xl bg-amber-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {restoring ? "Restoring..." : "Restore Backup"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

export default Settings;
