import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Trash2 } from "lucide-react";
import Modal from "../ui/Modal";
import { resetUserData } from "../../api/admin.api";

/**
 * Per-user danger zone: scoped to just this annotator's own dedicated
 * project, so it's safe to surface anywhere an admin is looking at one user -
 * their UserDetail page and their profile view both use this.
 *
 *   "tasks"    keeps their progress history; wipes tasks/submissions/audio.
 *   "progress" wipes all of that too.
 */
export default function UserResetDangerZone({ userId, userName, onReset }) {
  const [resetScope, setResetScope] = useState(null); // "tasks" | "progress" | null
  const [resetBusy, setResetBusy] = useState(false);
  const [resetText, setResetText] = useState("");

  const closeReset = () => {
    if (resetBusy) return;
    setResetScope(null);
    setResetText("");
  };

  const handleReset = async () => {
    setResetBusy(true);
    try {
      const res = await resetUserData(userId, resetScope);
      const s = res.data.data;
      toast.success(
        `Removed ${s.tasksDeleted} task(s), ${s.submissionsDeleted} submission(s)` +
          (s.progressRowsDeleted ? ", cleared their progress history." : ".")
      );
      setResetScope(null);
      setResetText("");
      await onReset?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Reset failed.");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <>
      <div className="card mb-10 border-red-300 bg-red-50/40">
        <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide flex items-center gap-2">
          <AlertTriangle size={15} /> Danger zone
        </h2>
        <p className="text-primary-500 text-sm mt-1 mb-4">
          Scoped to this user's own dedicated project only - no other annotator is affected.
          No backup is taken and this cannot be undone.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setResetScope("tasks")}
            className="btn-secondary inline-flex items-center gap-2 border-red-400 text-red-700 hover:bg-red-100"
          >
            <Trash2 size={16} /> Reset tasks
          </button>
          <button
            type="button"
            onClick={() => setResetScope("progress")}
            className="btn-secondary inline-flex items-center gap-2 border-red-400 text-red-700 hover:bg-red-100"
          >
            <Trash2 size={16} /> Reset tasks &amp; progress
          </button>
        </div>
      </div>

      {resetScope && (
        <Modal
          title={resetScope === "progress" ? "Reset tasks & progress" : "Reset tasks"}
          onClose={closeReset}
          size="sm"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                Permanently deletes {userName || "this user"}'s tasks, submissions, and Cloudinary
                audio (their own dedicated project only - nobody else is affected).{" "}
                {resetScope === "progress"
                  ? "Their lifetime progress history is also cleared."
                  : "Their lifetime progress history is kept."}{" "}
                No backup is taken and this cannot be undone.
              </span>
            </div>
            <div>
              <label className="label">Type <span className="font-mono">RESET</span> to confirm</label>
              <input
                type="text"
                className="input"
                value={resetText}
                onChange={(e) => setResetText(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={closeReset} disabled={resetBusy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
                onClick={handleReset}
                disabled={resetBusy || resetText !== "RESET"}
              >
                {resetBusy ? "Resetting…" : "Reset"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
