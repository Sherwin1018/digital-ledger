import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import PageTransitionOverlay from "./PageTransitionOverlay";

function DashboardLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [transitionState, setTransitionState] = useState({
    visible: false,
    pathname: location.pathname,
    loginSuccess: false,
  });

  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1024;

      setIsDesktop(desktop);

      if (desktop) {
        setMobileOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleSidebarToggle = () => {
    if (isDesktop) {
      setCollapsed((prev) => !prev);
      return;
    }

    setMobileOpen((prev) => !prev);
  };

  useEffect(() => {
    const loginSuccess = Boolean(location.state?.loginSuccess);
    const showTimer = window.setTimeout(() => {
      setTransitionState({
        visible: true,
        pathname: location.pathname,
        loginSuccess,
      });
    }, 0);

    if (loginSuccess) {
      navigate(location.pathname, { replace: true, state: {} });
    }

    const hideTimer = window.setTimeout(() => {
      setTransitionState((current) => ({
        ...current,
        visible: false,
      }));
    }, 1000);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [location.pathname, location.state, navigate]);

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar
        collapsed={collapsed}
        isDesktop={isDesktop}
        mobileOpen={mobileOpen}
        onToggleDesktop={() => setCollapsed((prev) => !prev)}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div
        className={`
          transition-all
          duration-300
          ${collapsed ? "lg:ml-20" : "lg:ml-64"}
        `}
      >
        <Topbar
          showMenuButton={!isDesktop}
          onMenuClick={handleSidebarToggle}
        />

        <main className="p-4 sm:p-6">{children}</main>
      </div>

      {transitionState.visible && (
        <PageTransitionOverlay
          pathname={transitionState.pathname}
          loginSuccess={transitionState.loginSuccess}
        />
      )}

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </div>
  );
}

export default DashboardLayout;
