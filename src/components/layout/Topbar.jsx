import { useEffect, useMemo, useState } from "react";
import { Bell, Menu, UserCircle } from "lucide-react";
import { Menu as HeadlessMenu } from "@headlessui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getNotifications } from "../../services/notificationService";
import { getAdminProfile } from "../../services/profileService";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

const NOTIFICATION_LAST_SEEN_KEY = "digital-ledger-notifications-last-seen";

function formatNotificationTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function toneClass(tone) {
  if (tone === "success") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (tone === "warning") {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-cyan-100 text-cyan-700";
}

function Topbar({ showMenuButton, onMenuClick }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout, configError } = useAuth();
  const [profile, setProfile] = useState({
    fullName: "Admin",
    photoDataUrl: "",
    email: "",
  });
  const [notifications, setNotifications] = useState([]);
  const [notificationError, setNotificationError] = useState("");
  const [lastSeenTimestamp, setLastSeenTimestamp] = useState(() => {
    const value = window.localStorage.getItem(NOTIFICATION_LAST_SEEN_KEY);
    return value ? Number(value) : 0;
  });

  const pageTitles = {
    "/dashboard": "Dashboard",
    "/customers": "Customers",
    "/debts": "Debts",
    "/payments": "Payments",
    "/reports": "Reports",
    "/settings": "Settings",
    "/profile": "Profile",
  };

  const title = pageTitles[pathname] ?? "Digital Ledger";

  useEffect(() => {
    if (configError || !user) {
      return;
    }

    let active = true;

    async function loadTopbarData() {
      try {
        const [nextProfile, nextNotifications] = await Promise.all([
          getAdminProfile(user),
          getNotifications(),
        ]);

        if (!active) {
          return;
        }

        setProfile(nextProfile);
        setNotifications(nextNotifications);
        setNotificationError("");
      } catch (error) {
        if (!active) {
          return;
        }

        setNotificationError(
          getFirebaseErrorMessage(error, "Unable to load notifications."),
        );
      }
    }

    loadTopbarData();

    const handleProfileUpdated = () => {
      loadTopbarData();
    };

    window.addEventListener("admin-profile-updated", handleProfileUpdated);

    return () => {
      active = false;
      window.removeEventListener("admin-profile-updated", handleProfileUpdated);
    };
  }, [configError, user]);

  const unreadCount = useMemo(
    () =>
      notifications.filter(
        (notification) => notification.createdAt.getTime() > lastSeenTimestamp,
      ).length,
    [lastSeenTimestamp, notifications],
  );

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const handleOpenProfile = () => {
    navigate("/profile");
  };

  const markNotificationsAsRead = () => {
    const timestamp = Date.now();
    window.localStorage.setItem(NOTIFICATION_LAST_SEEN_KEY, String(timestamp));
    setLastSeenTimestamp(timestamp);
  };

  return (
    <header className="flex items-center justify-between bg-white px-6 py-4 shadow">
      <div className="flex items-center">
        {showMenuButton && (
          <button
            type="button"
            onClick={onMenuClick}
            className="mr-4 rounded-lg p-2 transition hover:bg-slate-100"
            aria-label="Toggle sidebar"
          >
            <Menu size={24} />
          </button>
        )}

        <h1 className="text-2xl font-bold text-slate-700">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        <HeadlessMenu as="div" className="relative">
          <HeadlessMenu.Button
            type="button"
            onClick={markNotificationsAsRead}
            className="relative rounded-full p-2 transition hover:bg-slate-100"
          >
            <Bell className="text-slate-700" />
            <span className="absolute -right-1 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold text-white">
              {unreadCount}
            </span>
          </HeadlessMenu.Button>

          <HeadlessMenu.Items className="absolute right-0 z-50 mt-3 w-[22rem] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl focus:outline-none">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Notifications</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {unreadCount} unread notification{unreadCount === 1 ? "" : "s"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={markNotificationsAsRead}
                  className="text-xs font-semibold text-cyan-600 transition hover:text-cyan-500"
                >
                  Mark all as read
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto p-3">
              {notificationError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {notificationError}
                </div>
              ) : notifications.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  No notifications yet.
                </div>
              ) : (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="mb-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 last:mb-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{notification.title}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {notification.description}
                        </p>
                      </div>

                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold ${toneClass(notification.tone)}`}
                      >
                        {notification.tone}
                      </span>
                    </div>

                    <p className="mt-3 text-xs text-slate-400">
                      {formatNotificationTime(notification.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </HeadlessMenu.Items>
        </HeadlessMenu>

        <HeadlessMenu as="div" className="relative">
          <HeadlessMenu.Button className="group relative flex items-center gap-3 rounded-full p-1 transition hover:bg-slate-100">
            {profile.photoDataUrl ? (
              <img
                src={profile.photoDataUrl}
                alt="Admin profile"
                className="h-10 w-10 rounded-full border border-slate-200 object-cover"
              />
            ) : (
              <UserCircle size={36} className="text-slate-900" />
            )}

            <span className="sr-only">{profile.email || user?.email || "Admin profile"}</span>

            <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 min-w-max rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100">
              {profile.email || user?.email || "Admin"}
            </span>
          </HeadlessMenu.Button>

          <HeadlessMenu.Items className="absolute right-0 z-50 mt-3 w-56 rounded-3xl border border-slate-200 bg-white p-2 shadow-2xl focus:outline-none">
            <div className="border-b border-slate-100 px-3 py-3">
              <p className="font-semibold text-slate-900">{profile.fullName || "Admin"}</p>
              <p className="mt-1 text-xs text-slate-500">{profile.email || user?.email}</p>
            </div>

            <HeadlessMenu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={handleOpenProfile}
                  className={`w-full rounded-2xl px-4 py-3 text-left text-sm ${
                    active ? "bg-slate-100" : ""
                  }`}
                >
                  Profile
                </button>
              )}
            </HeadlessMenu.Item>

            <HeadlessMenu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={handleLogout}
                  className={`w-full rounded-2xl px-4 py-3 text-left text-sm text-red-500 ${
                    active ? "bg-slate-100" : ""
                  }`}
                >
                  Logout
                </button>
              )}
            </HeadlessMenu.Item>
          </HeadlessMenu.Items>
        </HeadlessMenu>
      </div>
    </header>
  );
}

export default Topbar;
