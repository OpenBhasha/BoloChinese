import { useEffect, useState } from "react";
import AdminLayout from "../../components/layout/AdminLayout";
import StatCard from "../../components/ui/StatCard";
import Modal from "../../components/ui/Modal";
import {
  getDashboard,
  getBackupStatus,
  getCloudinaryUsage,
  runCleanup,
  resetDatabase,
} from "../../api/admin.api";
import { Users, FolderOpen, ClipboardList, ShieldCheck, Trash2, AlertTriangle, Cloud } from "lucide-react";
import { PageSpinner } from "../../components/ui/Spinner";
import { formatDuration, formatDateTime, formatBytes } from "../../utils/format";
import toast from "react-hot-toast";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const [backup, setBackup] = useState(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupText, setCleanupText] = useState("");

  // null while loading, { error: "..." } if unavailable, else the usage payload.
  const [cloudinaryUsage, setCloudinaryUsage] = useState(null);

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

  // Separate from the rest of the dashboard load - a slow/misconfigured
  // Cloudinary account shouldn't hold up or break the numbers that come
  // from our own DB.
  const loadCloudinaryUsage = () =>
    getCloudinaryUsage()
      .then((r) => setCloudinaryUsage(r.data.data))
      .catch((err) => setCloudinaryUsage({ error: err.response?.data?.message || "Unavailable" }));

  useEffect(() => {
    Promise.all([loadDashboard(), loadBackup()]).finally(() => setLoading(false));
    loadCloudinaryUsage();
  }, []);

  const handleCleanup = async () => {
    setCleanupBusy(true);
    try {
      const res = await runCleanup();
      const s = res.data.data;
      toast.success(`Archived ${s.tasksArchived} task(s), purged ${s.audioPurged} audio file(s). Progress retained.`);
      setCleanupOpen(false);
      setCleanupText("");
      await Promise.all([loadDashboard(), loadBackup()]);
      loadCloudinaryUsage();
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
      loadCloudinaryUsage();
    } catch (err) {
      toast.error(err.response?.data?.message || "Reset failed.");
    } finally {
      setResetBusy(false);
    }
  };

  const pending = backup?.pending || {};
  const canCleanup = !!backup?.canCleanup && !backup?.inProgress;
  const busyOp = backup?.inProgress; // "cleanup" | "reset" | null

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

          {/* Cleanup */}
          <div className="card mt-6">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div>
                <h2 className="text-sm font-semibold text-primary-500 uppercase tracking-wide">Cleanup</h2>
                <p className="text-primary-400 text-sm mt-1">
                  Archives finished tasks - hides them from annotators, while tasks, submissions,
                  and progress are kept - and permanently deletes their audio from Cloudinary.
                  Unfinished tasks are untouched. This doesn't take a backup for you; make sure
                  you've saved anything you need first.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
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
            </div>

            {backup?.lastCleanupAt && (
              <p className="text-xs text-primary-400 mb-4">
                Last cleanup: {formatDateTime(backup.lastCleanupAt)}
                {backup.lastCleanupStats?.tasksArchived != null
                  ? ` · archived ${backup.lastCleanupStats.tasksArchived} task(s), purged ${backup.lastCleanupStats.audioPurged ?? 0} audio file(s)`
                  : ""}
              </p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => setCleanupOpen(true)}
                disabled={!canCleanup}
                title={canCleanup ? "" : "Nothing finished to clean up yet"}
                className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Trash2 size={16} /> Clean up finished tasks &amp; audio
              </button>
              {!canCleanup && (pending.finishedTasks ?? 0) === 0 && (
                <span className="text-xs text-primary-400">Nothing finished yet.</span>
              )}
            </div>
          </div>

          {/* Cloudinary storage */}
          <div className="card mt-6">
            <h2 className="text-sm font-semibold text-primary-500 uppercase tracking-wide flex items-center gap-2 mb-4">
              <Cloud size={15} /> Cloudinary Storage
            </h2>
            {!cloudinaryUsage ? (
              <p className="text-sm text-primary-400">Loading…</p>
            ) : cloudinaryUsage.error ? (
              <p className="text-sm text-primary-400">Unavailable — {cloudinaryUsage.error}</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-primary-500">Used</span>
                  <span className="font-bold text-lg text-primary-900">{formatBytes(cloudinaryUsage.storageUsedBytes)}</span>
                </div>

                {cloudinaryUsage.storageLimitBytes != null ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-primary-500">Available</span>
                      <span className="font-bold text-lg text-primary-900">
                        {formatBytes(Math.max(0, cloudinaryUsage.storageLimitBytes - cloudinaryUsage.storageUsedBytes))}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-primary-100 overflow-hidden">
                      <div
                        className="h-full bg-primary-600"
                        style={{
                          width: `${Math.min(100, Math.round((cloudinaryUsage.storageUsedBytes / cloudinaryUsage.storageLimitBytes) * 100))}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-primary-400">
                      {Math.round((cloudinaryUsage.storageUsedBytes / cloudinaryUsage.storageLimitBytes) * 100)}% of{" "}
                      {formatBytes(cloudinaryUsage.storageLimitBytes)} plan limit
                    </p>
                  </>
                ) : cloudinaryUsage.creditsLimit != null ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-primary-500">Credits used</span>
                      <span className="font-bold text-lg text-primary-900">
                        {cloudinaryUsage.creditsUsage} / {cloudinaryUsage.creditsLimit}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-primary-100 overflow-hidden">
                      <div
                        className="h-full bg-primary-600"
                        style={{ width: `${Math.min(100, cloudinaryUsage.creditsUsedPercent ?? 0)}%` }}
                      />
                    </div>
                    <p className="text-xs text-primary-400">
                      Your plan shares one credit pool across storage, bandwidth, and transformations -
                      there's no separate storage cap to show as "available."
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-primary-400">Your plan doesn't report a storage limit.</p>
                )}

                {cloudinaryUsage.plan && (
                  <p className="text-xs text-primary-400">
                    Plan: {cloudinaryUsage.plan}
                    {cloudinaryUsage.lastUpdated ? ` · updated ${cloudinaryUsage.lastUpdated}` : ""}
                  </p>
                )}
              </div>
            )}
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
              This permanently deletes <strong>{pending.audioFiles ?? 0} audio file(s)</strong> from
              Cloudinary for {pending.finishedTasks ?? 0} finished task(s) ({pending.finishedSubmissions ?? 0}{" "}
              submission(s)). The tasks and submissions themselves are kept and still count toward
              progress - they're just hidden from the annotator. Unfinished tasks are untouched.
            </p>
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                This doesn't take a backup for you. Make sure you've saved a copy of anything
                you need before continuing - the audio deletion can't be undone.
              </span>
            </div>
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
                {cleanupBusy ? "Cleaning…" : "Archive & purge audio"}
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
