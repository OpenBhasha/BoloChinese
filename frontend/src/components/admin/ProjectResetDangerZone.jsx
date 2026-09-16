import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Trash2 } from "lucide-react";
import Modal from "../ui/Modal";
import { resetProjectData } from "../../api/admin.api";

/**
 * Per-project danger zone - same idea as UserResetDangerZone, keyed by
 * project instead of a user. Works for a shared project too: "progress"
 * clears the ledger for every current assignee, not just one, since the
 * ledger isn't broken down by project - the copy below says so.
 *
 *   "tasks"    keeps every assignee's progress history; wipes
 *              tasks/submissions/audio for this project.
 *   "progress" wipes all of that too, for every assignee.
 */
export default function ProjectResetDangerZone({ projectId, projectName, onReset }) {
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
      const res = await resetProjectData(projectId, resetScope);
      const s = res.data.data;
      toast.success(
        `Removed ${s.tasksDeleted} task(s), ${s.submissionsDeleted} submission(s)` +
          (s.progressRowsDeleted ? `, cleared progress for ${s.usersAffected} annotator(s).` : ".")
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
      <div className="card mb-8 border-red-300 bg-red-50/40">
        <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide flex items-center gap-2">
          <AlertTriangle size={15} /> Danger zone
        </h2>
        <p className="text-primary-500 text-sm mt-1 mb-4">
          Scoped to this project only. No backup is taken and this cannot be undone.
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
                Permanently deletes every task, submission, and Cloudinary audio file in{" "}
                {projectName ? `"${projectName}"` : "this project"}.{" "}
                {resetScope === "progress"
                  ? "It also clears the progress history for every annotator currently assigned to this project - if it's a shared project, that's all of their history, not just this project's share of it."
                  : "Progress history for its assignees is kept."}{" "}
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
