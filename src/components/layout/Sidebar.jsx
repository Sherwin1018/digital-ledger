import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Wallet,
  CreditCard,
  FileText,
  Settings,
  LogOut,
  Store,
  Menu,
  Archive,
} from "lucide-react";
import { useAuth } from "../../context/useAuth";
import { useToast } from "../../context/useToast";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

function Sidebar({
  collapsed,
  isDesktop,
  mobileOpen,
  onToggleDesktop,
  onCloseMobile,
}) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { showToast } = useToast();
  const menuItems = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/customers", icon: Users, label: "Customers" },
    { to: "/debts", icon: Wallet, label: "Debts" },
    { to: "/payments", icon: CreditCard, label: "Payments" },
    { to: "/archives", icon: Archive, label: "Archives" },
    { to: "/reports", icon: FileText, label: "Reports" },
    { to: "/settings", icon: Settings, label: "Settings" },
  ];
  const isCompact = isDesktop && collapsed;

  const handleLogout = async () => {
    try {
      showToast({ type: "info", message: "Logging out..." });
      await logout();
      window.setTimeout(() => {
        navigate("/", { replace: true, state: { logoutSuccess: true } });
      }, 1000);
    } catch (error) {
      showToast({
        type: "error",
        message: getFirebaseErrorMessage(error, "Logout failed. Please try again."),
      });
    }
  };

  return (
    <aside
      className={`
        fixed
        top-0
        left-0
        z-40
        h-screen
        w-64
        bg-slate-900
        text-white
        transition-all
        duration-300
        ${isCompact ? "lg:w-20" : "lg:w-64"}
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0
      `}
    >
      <div
        className={`border-b border-slate-700 ${
          isCompact ? "flex items-center justify-center py-6" : "flex items-center justify-between gap-3 p-6"
        }`}
      >
        {!isCompact ? (
          <button
            type="button"
            onClick={isDesktop ? onToggleDesktop : undefined}
            className={`flex items-center gap-3 ${
              isDesktop ? "cursor-pointer" : "cursor-default"
            }`}
            aria-label={isDesktop ? "Collapse sidebar" : undefined}
          >
            <Store size={28} />
            <span className="text-2xl font-bold">Digital Ledger</span>
          </button>
        ) : null}

        {isCompact ? (
          <button
            type="button"
            onClick={onToggleDesktop}
            className="rounded-lg p-2 transition hover:bg-slate-800"
            aria-label="Expand sidebar"
          >
            <Menu size={24} />
          </button>
        ) : null}
      </div>

      <nav className="px-3 mt-2 space-y-2">
        {menuItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={!isDesktop ? onCloseMobile : undefined}
            className={({ isActive }) =>
              `flex items-center ${
                isCompact ? "justify-center" : "gap-3"
              } p-3 rounded-lg transition ${
                isActive
                  ? "bg-cyan-500 text-white"
                  : "hover:bg-slate-700"
              }`
            }
          >
            <item.icon size={22} />

            {!isCompact && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="absolute bottom-0 w-full p-3 border-t border-slate-700">
        <button
          type="button"
          onClick={handleLogout}
          className={`w-full flex items-center ${
            isCompact ? "justify-center" : "gap-3"
          } p-3 rounded-lg transition duration-1000 hover:bg-red-600 active:scale-95`}
        >
          <LogOut size={22} />

          {!isCompact && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
