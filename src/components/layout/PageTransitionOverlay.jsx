import {
  CreditCard,
  FileText,
  LayoutDashboard,
  Settings,
  Store,
  UserCircle,
  Users,
  Wallet,
} from "lucide-react";

const pageTransitionIcons = {
  "/dashboard": LayoutDashboard,
  "/customers": Users,
  "/debts": Wallet,
  "/payments": CreditCard,
  "/reports": FileText,
  "/settings": Settings,
  "/profile": UserCircle,
};

function PageTransitionOverlay({ pathname, loginSuccess }) {
  const Icon = loginSuccess ? Store : pageTransitionIcons[pathname] || Store;

  return (
    <div
      key={`${loginSuccess ? "login" : "page"}-${pathname}`}
      className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-slate-950/20 backdrop-blur-sm page-transition-overlay"
      aria-hidden="true"
    >
      <div className="grid h-24 w-24 place-items-center rounded-full border border-white/50 bg-white/95 text-cyan-600 shadow-2xl page-transition-icon">
        <Icon size={44} strokeWidth={2.4} />
      </div>
    </div>
  );
}

export default PageTransitionOverlay;
