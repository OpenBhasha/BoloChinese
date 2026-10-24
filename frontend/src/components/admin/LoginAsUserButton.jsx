import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../../context/AuthContext";
import { impersonateUser } from "../../api/admin.api";

// Admin-only: swaps the session for a short-lived one as this annotator. The
// caller decides eligibility (active, verified annotator) - the server enforces
// it too.
export default function LoginAsUserButton({
  userId,
  className = "btn-secondary flex items-center gap-1.5 py-1.5 px-3 text-xs",
}) {
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      const res = await impersonateUser(userId);
      const data = res.data.data;
      startImpersonation(data);
      toast.success(`Now logged in as ${data.user.name}`);
      navigate("/user");
    } catch (err) {
      toast.error(err.response?.data?.message || "Couldn't log in as this user");
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={className}
      title="Open the app as this user"
    >
      <LogIn size={13} /> {busy ? "Logging in…" : "Login as"}
    </button>
  );
}
