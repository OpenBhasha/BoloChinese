import { useEffect, useState } from "react";
import AdminLayout from "../../components/layout/AdminLayout";
import StatCard from "../../components/ui/StatCard";
import Modal from "../../components/ui/Modal";
import {
  getDashboard,
  getBackupStatus,
  downloadBackup,
  runCleanup,
  resetDatabase,
} from "../../api/admin.api";
import { Users, FolderOpen, ClipboardList, ShieldCheck, Archive, Trash2, AlertTriangle } from "lucide-react";
import { PageSpinner } from "../../components/ui/Spinner";
import { formatDuration, formatDateTime, downloadBlob } from "../../utils/format";
import toast from "react-hot-toast";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const [backup, setBackup] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupText, setCleanupText] = useState("");

  const [resetScope, setResetScope] = useState(null); // "tasks" | "retain-users" | "full" | null
  const [resetBusy, setResetBusy] = useState(false);
  const [resetText, setResetText] = useState("");

  const loadDashboard = () =>
    getDashboard()
      .then((r) => setStats(r.data.data))
      .catch(() => toast.error("Failed to load dashboard"));

  const loadBackup = () =>
    getBackupStatus()
      .then((r) => setBackup(r.data.data))
      .catch(() => setBackup(null));

  useEffect(() => {
    Promise.all([loadDashboard(), loadBackup()]).finally(() => setLoading(false));
  }, []);

  const handleBackup = async () => {
    setBackupBusy(true);
    try {
      const res = await downloadBackup();
      const name =
        res.headers?.["content-disposition"]?.match(/filename="?([^"]+)"?/)?.[1] ||
        `bolochinese-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      downloadBlob(res.data, name, "application/zip");
      toast.success("Backup downloaded.");
      await loadBackup();
    } catch (err) {
      toast.error(err.response?.data?.message || "Backup failed.");
    } finally {
      setBackupBusy(false);
    }
  };

  const handleCleanup = async () => {
    setCleanupBusy(true);
    try {
      const res = await runCleanup();
      const s = res.data.data;
      toast.success(`Cleaned up ${s.tasksDeleted} task(s). Progress retained.`);
      setCleanupOpen(false);
      setCleanupText("");
      await Promise.all([loadDashboard(), loadBackup()]);
    } catch (err) {
      toast.error(err.response?.data?.message || "Cleanup failed.");
    } finally {
      setCleanupBusy(false);
    }
  };

  const closeReset = () => {
    if (resetBusy) return;
    setResetScope(null);
    setResetText("");
  };

  const handleReset = async () => {
    setResetBusy(true);
    try {
      const res = await resetDatabase(resetScope);
      const s = res.data.data;
      const parts = [`${s.tasksDeleted} task(s)`, `${s.submissionsDeleted} submission(s)`];
      if (s.projectsDeleted) parts.push(`${s.projectsDeleted} project(s)`);
      if (s.usersDeleted) parts.push(`${s.usersDeleted} user(s)`);
      toast.success(`Reset complete. Removed ${parts.join(", ")}.`);
      setResetScope(null);
      setResetText("");
      await Promise.all([loadDashboard(), loadBackup()]);
    } catch (err) {
      toast.error(err.response?.data?.message || "Reset failed.");
    } finally {
      setResetBusy(false);
    }
  };

  const pending = backup?.pending || {};
  const canCleanup = !!backup?.canCleanup && !backup?.inProgress;
  const busyOp = backup?.inProgress; // "backup" | "cleanup" | "reset" | null

  return (
    <AdminLayout>
      <h1 className="text-xl sm:text-2xl font-bold text-primary-900 mb-1">Dashboard</h1>
      <p className="text-primary-400 text-sm mb-6 sm:mb-8">Overview of your Bolo platform</p>

      {loading ? <PageSpinner /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-10">
            <StatCard label="Total Users" value={stats?.users?.total} icon={Users} color="primary"
              sub={`${stats?.users?.pending} pending verification`} />
            <StatCard label="Projects" value={stats?.projects?.total} icon={FolderOpen} color="blue" />
            <StatCard label="Total Tasks" value={stats?.tasks?.total} icon={ClipboardList} color="amber" />
            <StatCard label="Verified Users" value={stats?.users?.verified} icon={ShieldCheck} color="emerald" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* User breakdown */}
            <div className="card">
              <h2 className="text-sm font-semibold text-primary-500 uppercase tracking-wide mb-4">Users</h2>
              <div className="space-y-3">
                {[
                  { label: "Verified", value: stats?.users?.verified, color: "text-emerald-500" },
                  { label: "Pending", value: stats?.users?.pending, color: "text-amber-500" },
                  { label: "Total", value: stats?.users?.total, color: "text-primary-900" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-primary-100 last:border-0">
                    <span className="text-sm text-primary-500">{label}</span>
                    <span className={`font-bold text-lg ${color}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Task submission breakdown - lifetime (never drops after a cleanup) */}
            <div className="card">
              <h2 className="text-sm font-semibold text-primary-500 uppercase tracking-wide mb-4">
                Tasks <span className="text-primary-300 normal-case font-normal">· lifetime</span>
              </h2>
              <div className="space-y-3">
                {[
                  { label: "Validated", value: stats?.tasks?.validated ?? 0, color: "text-emerald-500" },
                  { label: "Edited", value: stats?.tasks?.edited ?? stats?.tasks?.corrected ?? 0, color: "text-lime-600" },
                  { label: "Discarded", value: stats?.tasks?.discarded ?? 0, color: "text-red-500" },
                  { label: "Total Audio Files", value: stats?.tasks?.recorded ?? 0, color: "text-emerald-500" },
                  { label: "Total Audio Duration", value: formatDuration(stats?.tasks?.audioDurationSeconds), color: "text-primary-900" },
                  { label: "Avg Audio Duration", value: formatDuration(stats?.tasks?.avgAudioDurationSeconds), color: "text-primary-900" },
                  { label: "Avg time per task", value: formatDuration((stats?.tasks?.avgTimePerTaskMs ?? 0) / 1000), color: "text-primary-900" },
                  { label: "Total Tasks (live)", value: stats?.tasks?.total, color: "text-primary-900" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-primary-100 last:border-0">
                    <span className="text-sm text-primary-500">{label}</span>
                    <span className={`font-bold text-lg ${color}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Backup & cleanup */}
          <div className="card mt-6">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div>
                <h2 className="text-sm font-semibold text-primary-500 uppercase tracking-wide">Backup &amp; Cleanup</h2>
                <p className="text-primary-400 text-sm mt-1">
                  Download the day's finished tasks, audio, and progress, then wipe them.
                  Progress totals are kept forever; unfinished tasks stay for the annotator.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              <div>
                <p className="text-xs text-primary-400 uppercase tracking-wide">Finished tasks</p>
                <p className="font-bold text-lg text-primary-900">{pending.finishedTasks ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-primary-400 uppercase tracking-wide">Submissions</p>
                <p className="font-bold text-lg text-primary-900">{pending.finishedSubmissions ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-primary-400 uppercase tracking-wide">Audio files</p>
                <p className="font-bold text-lg text-primary-900">{pending.audioFiles ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-primary-400 uppercase tracking-wide">Last backup</p>
                <p className="font-medium text-sm text-primary-900">
                  {backup?.lastBackupAt ? formatDateTime(backup.lastBackupAt) : "Never"}
                </p>
              </div>
            </div>

            {backup?.lastBackupHadErrors && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>The last backup had audio download errors. Re-download a clean backup before cleaning up.</span>
              </div>
            )}
            {backup?.lastCleanupAt && (
              <p className="text-xs text-primary-400 mb-4">
                Last cleanup: {formatDateTime(backup.lastCleanupAt)}
                {backup.lastCleanupStats?.tasksDeleted != null
                  ? ` · removed ${backup.lastCleanupStats.tasksDeleted} task(s)`
                  : ""}
              </p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleBackup}
                disabled={backupBusy || !!busyOp}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Archive size={16} /> {backupBusy ? "Preparing…" : "Download backup (.zip)"}
              </button>
              <button
                type="button"
                onClick={() => setCleanupOpen(true)}
                disabled={!canCleanup}
                title={canCleanup ? "" : "Download a fresh backup first"}
                className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Trash2 size={16} /> Clean up finished tasks &amp; audio
              </button>
              {!canCleanup && !backup?.lastBackupHadErrors && (
                <span className="text-xs text-primary-400">Download a fresh backup to enable cleanup.</span>
              )}
            </div>
          </div>

          {/* Danger zone */}
          <div className="card mt-6 border-red-300 bg-red-50/40">
            <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide flex items-center gap-2">
              <AlertTriangle size={15} /> Danger zone
            </h2>
            <p className="text-primary-500 text-sm mt-1 mb-4">
              Removes all tasks, submissions, and audio — plus every Cloudinary audio file.
              No backup is taken. This cannot be undone.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => setResetScope("tasks")}
                disabled={!!busyOp}
                className="btn-secondary inline-flex items-center gap-2 border-red-400 text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 size={16} /> Reset all tasks
              </button>
              <button
                type="button"
                onClick={() => setResetScope("retain-users")}
                disabled={!!busyOp}
                className="btn-secondary inline-flex items-center gap-2 border-red-400 text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 size={16} /> Reset — keep users &amp; projects
              </button>
              <button
                type="button"
                onClick={() => setResetScope("full")}
                disabled={!!busyOp}
                className="btn-secondary inline-flex items-center gap-2 border-red-400 text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 size={16} /> Reset — keep admin accounts only
              </button>
            </div>
          </div>
        </>
      )}

      {cleanupOpen && (
        <Modal title="Clean up finished tasks & audio" onClose={() => !cleanupBusy && setCleanupOpen(false)} size="sm">
          <div className="space-y-4">
            <p className="text-sm text-primary-600">
              This permanently deletes <strong>{pending.finishedTasks ?? 0} finished task(s)</strong>,{" "}
              {pending.finishedSubmissions ?? 0} submission(s), and {pending.audioFiles ?? 0} audio file(s).
              Their counts are folded into each annotator's permanent progress first. Unfinished tasks are untouched.
            </p>
            {backup?.lastBackupHadErrors && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>The last backup reported audio errors — some audio may not be saved. Re-download first.</span>
              </div>
            )}
            <div>
              <label className="label">Type <span className="font-mono">CLEANUP</span> to confirm</label>
              <input
                type="text"
                className="input"
                value={cleanupText}
                onChange={(e) => setCleanupText(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCleanupOpen(false)} disabled={cleanupBusy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
                onClick={handleCleanup}
                disabled={cleanupBusy || cleanupText !== "CLEANUP"}
              >
                {cleanupBusy ? "Cleaning…" : "Delete & keep progress"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {resetScope && (
        <Modal
          title={
            resetScope === "full"
              ? "Reset — keep admin accounts only"
              : resetScope === "retain-users"
              ? "Reset — keep users & projects"
              : "Reset all tasks"
          }
          onClose={closeReset}
          size="sm"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                {resetScope === "full" ? (
                  <>
                    Permanently deletes every project, assignment, task, submission, and all progress
                    history, plus all Cloudinary audio. All non-admin user accounts are also deleted.
                  </>
                ) : resetScope === "retain-users" ? (
                  <>
                    Permanently deletes all tasks, submissions, and progress history, plus all
                    Cloudinary audio. User accounts and projects (with their assignments) are kept.
                  </>
                ) : (
                  <>
                    Permanently deletes all tasks, submissions, and their Cloudinary audio. Users,
                    projects, assignments, and all progress history are kept.
                  </>
                )}{" "}
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
                {resetBusy ? "Resetting…" : "Reset database"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
