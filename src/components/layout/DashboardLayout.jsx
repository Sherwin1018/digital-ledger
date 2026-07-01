import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

function DashboardLayout({ children }) {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

        <main className="p-6">{children}</main>
      </div>

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
