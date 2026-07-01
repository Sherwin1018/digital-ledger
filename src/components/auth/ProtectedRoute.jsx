import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/useAuth";

function ProtectedRoute({ children }) {
  const { user, loading, configError } = useAuth();
  const location = useLocation();

  if (configError) {
    return (
      <div className="min-h-screen bg-slate-100 px-6 py-10">
        <div className="mx-auto max-w-2xl rounded-3xl border border-amber-300 bg-white p-8 shadow-lg">
          <h1 className="text-2xl font-bold text-slate-900">Firebase setup incomplete</h1>
          <p className="mt-3 text-slate-600">
            The app cannot load protected pages yet because Firebase environment
            values are missing.
          </p>
          <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {configError}
          </p>
          <p className="mt-4 text-sm text-slate-500">
            Create a `.env.local` file from `.env.example`, paste your Firebase
            project values, then restart the Vite server.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-100">
        <p className="text-lg font-medium text-slate-600">Checking session...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return children;
}

export default ProtectedRoute;
