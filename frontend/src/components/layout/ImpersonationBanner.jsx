import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

// Shown on every user page while an admin is acting as an annotator.
export default function ImpersonationBanner() {
  const { user, isImpersonating, stopImpersonation } = useAuth();
  const navigate = useNavigate();
  if (!isImpersonating) return null;

  const handleExit = () => {
    const returnTo = stopImpersonation();
    navigate(returnTo || "/admin/users");
  };

  return (
    <div
      role="status"
      className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-amber-100 border-b border-amber-300 text-amber-900 text-sm"
    >
      <p className="min-w-0 flex items-center gap-2">
        <ShieldAlert size={16} className="shrink-0" />
        <span className="truncate">
          Logged in as <strong>{user?.name}</strong> ({user?.email}) - actions are saved as this user.
        </span>
      </p>
      <button
        type="button"
        onClick={handleExit}
        className="shrink-0 px-3 py-1 rounded-md bg-amber-900 text-amber-50 text-xs font-semibold hover:bg-amber-800 transition"
      >
        Exit to admin
      </button>
    </div>
  );
}
