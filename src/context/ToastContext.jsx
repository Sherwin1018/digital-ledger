import { createContext, useCallback, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

const ToastContext = createContext({
  showToast: () => {},
});

const toastIcons = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const toastClasses = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-cyan-200 bg-cyan-50 text-cyan-800",
};

function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const showToast = useCallback(({ type = "info", message }) => {
    if (!message) {
      return;
    }

    const id = Date.now();
    setToast({ id, type, message });

    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 2000);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);
  const Icon = toast ? toastIcons[toast.type] || Info : Info;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className="fixed right-4 top-4 z-[90] max-w-sm animate-[toastIn_160ms_ease-out]">
          <div
            className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl ${toastClasses[toast.type] || toastClasses.info}`}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <p className="font-medium">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 rounded-full p-1 opacity-70 transition hover:bg-white/50 hover:opacity-100"
              aria-label="Close notification"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export { ToastContext, ToastProvider };
