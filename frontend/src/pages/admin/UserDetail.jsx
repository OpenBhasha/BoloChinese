import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ChevronLeft, ClipboardList, CheckCircle2, Pencil, AlertTriangle, Clock3, Percent, BadgeCheck, Trash2, Mic, Timer, Download } from "lucide-react";
import AdminLayout from "../../components/layout/AdminLayout";
import Modal from "../../components/ui/Modal";
import StatCard from "../../components/ui/StatCard";
import { PageSpinner, Spinner } from "../../components/ui/Spinner";
import PaginationControls from "../../components/admin/PaginationControls";
import { paginateRows } from "../../utils/pagination";
import { formatDateTime, formatFileSize, formatDuration, downloadBlob } from "../../utils/format";
import { getUsersProgress, getUserSubmissions, streamSubmissionAudio, exportUserResults } from "../../api/admin.api";

export default function UserDetail() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await exportUserResults(id);
      const name = res.headers?.["content-disposition"]?.match(/filename="?([^"]+)"?/)?.[1]
        || `bolo-results-${id}.csv`;
      downloadBlob(res.data, name);
      toast.success("Export downloaded.");
    } catch {
      toast.error("Failed to export results.");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([getUsersProgress(), getUserSubmissions(id)])
      .then(([progressRes, submissionsRes]) => {
        const match = (progressRes.data.data || []).find((u) => u._id === id);
        setProgress(match || null);
        setSubmissions(submissionsRes.data.data || []);
      })
      .catch(() => toast.error("Failed to load user details"))
      .finally(() => setLoading(false));
  }, [id]);

  const searchQuery = search.trim().toLowerCase();
  const filteredSubmissions = useMemo(() => {
    if (!searchQuery) return submissions;
    return submissions.filter((s) => {
      const values = [s.taskId?.taskId, s.taskId?.dialogueId, s.projectId?.name, s.status];
      return values.some((value) => value?.toLowerCase().includes(searchQuery));
    });
  }, [submissions, searchQuery]);

  const { rows: paginatedSubmissions, currentPage, totalPages } = paginateRows(filteredSubmissions, page);

  useEffect(() => { setPage(1); }, [searchQuery]);

  const openSubmission = async (submission) => {
    setSelectedSubmission(submission);
    setAudioUrl(null);
    if (submission.audio?.publicId || submission.audio?.url) {
      setAudioLoading(true);
      try {
        const res = await streamSubmissionAudio(submission._id);
        setAudioUrl(URL.createObjectURL(res.data));
      } catch {
        toast.error("Failed to load audio.");
      } finally {
        setAudioLoading(false);
      }
    }
  };

  const closeSubmission = () => {
    setSelectedSubmission(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
  };

  if (loading) return <AdminLayout><PageSpinner /></AdminLayout>;
  if (!progress) return <AdminLayout><p className="text-slate-400">User not found.</p></AdminLayout>;

  return (
    <AdminLayout>
      <Link to="/admin/users" className="flex items-center gap-1.5 text-sm text-primary-500 hover:text-primary-900 mb-6 transition">
        <ChevronLeft size={16} /> Back to Users
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-primary-900 mb-1 flex items-center gap-2">
            {progress.name}
            {progress.identityFlagged && (
              <span className="badge-pending" title={progress.identityFlagReason || "Identity flagged"}>⚠ Identity flagged</span>
            )}
          </h1>
          <p className="text-primary-400 text-sm">
            {progress.email}
            {progress.username ? ` · @${progress.username}` : ""}
            {progress.phone ? ` · ${progress.phone}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Download size={16} /> {exporting ? "Exporting…" : "Export Results"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4 mb-10">
        <StatCard label="Assigned" value={progress.assigned} icon={ClipboardList} color="primary" />
        <StatCard label="Validated" value={progress.validated ?? 0} icon={BadgeCheck} color="emerald" />
        <StatCard label="Edited" value={progress.edited ?? progress.corrected ?? 0} icon={Pencil} color="blue" />
        <StatCard label="Discarded" value={progress.discarded ?? 0} icon={Trash2} color="red" />
        <StatCard label="Recorded" value={progress.recorded ?? 0} icon={Mic} color="emerald" />
        <StatCard label="Completed" value={progress.completed} icon={CheckCircle2} color="emerald" />
        <StatCard label="Erroneous" value={progress.erroneous} icon={AlertTriangle} color="red" />
        <StatCard label="Pending" value={progress.pending} icon={Clock3} color="amber" />
        <StatCard label="Audio Duration" value={formatDuration(progress.audioDurationSeconds)} icon={Timer} color="primary" />
        <StatCard label="Progress" value={`${progress.progressPercent}%`} icon={Percent} color="primary" />
      </div>

      <div className="admin-datatable card p-0 overflow-hidden">
        <div className="p-4 flex justify-between items-center border-b border-primary-100 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-primary-900">Submissions</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search submissions…"
            className="input w-full sm:w-64"
          />
        </div>

        <div className="sm:hidden divide-y divide-surface-border">
          {paginatedSubmissions.map((s) => (
            <button
              key={s._id}
              type="button"
              onClick={() => openSubmission(s)}
              className="block w-full text-left p-4 space-y-1.5 hover:bg-primary-50/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-primary-700 bg-primary-100 px-2 py-0.5 rounded">{s.taskId?.taskId}</span>
                <span className="text-xs text-primary-500 capitalize">{s.status}</span>
              </div>
              <p className="text-sm text-primary-900 truncate">{s.taskId?.dialogueId}</p>
              <p className="text-xs text-primary-400">{s.projectId?.name}</p>
            </button>
          ))}
          {!paginatedSubmissions.length && (
            <div className="px-5 py-10 text-center text-slate-500">No submissions found.</div>
          )}
        </div>

        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary-100 bg-primary-50/30">
                {["Task ID", "Dialogue ID", "Project", "Status", "Updated", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold text-primary-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedSubmissions.map((s) => (
                <tr key={s._id} className="border-b border-primary-100 hover:bg-primary-50/40 transition cursor-pointer" onClick={() => openSubmission(s)}>
                  <td className="px-5 py-4 font-mono text-xs text-primary-700">{s.taskId?.taskId}</td>
                  <td className="px-5 py-4 text-primary-900">{s.taskId?.dialogueId}</td>
                  <td className="px-5 py-4 text-primary-500">{s.projectId?.name}</td>
                  <td className="px-5 py-4 text-primary-500 capitalize">{s.status}</td>
                  <td className="px-5 py-4 text-primary-400">{formatDateTime(s.updatedAt)}</td>
                  <td className="px-5 py-4">
                    <button type="button" onClick={(e) => { e.stopPropagation(); openSubmission(s); }} className="text-xs font-semibold text-primary-700 hover:text-primary-900">
                      Details
                    </button>
                  </td>
                </tr>
              ))}
              {!paginatedSubmissions.length && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">No submissions found.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredSubmissions.length > 0 && totalPages > 1 && (
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            onPrev={() => setPage((prev) => Math.max(1, prev - 1))}
            onNext={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          />
        )}
      </div>

      {selectedSubmission && (
        <Modal title={`Submission · ${selectedSubmission.taskId?.taskId || ""}`} onClose={closeSubmission} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-[#c7d1c3] bg-[#eef2ec] p-4 min-w-0">
                <p className="label mb-2">Chinese Script</p>
                <p className="text-black whitespace-pre-wrap break-all text-sm leading-relaxed">
                  {selectedSubmission.correctedChineseTranscript || selectedSubmission.taskId?.chineseTranscript || "Not available."}
                </p>
              </div>
              <div className="rounded-2xl border border-[#c7d1c3] bg-[#e6eee2] p-4 min-w-0">
                <p className="label mb-2">Pinyin</p>
                <p className="text-black whitespace-pre-wrap break-all text-sm leading-relaxed">
                  {selectedSubmission.correctedPinyin || selectedSubmission.taskId?.pinyin || "Not available."}
                </p>
              </div>
            </div>

            {selectedSubmission.erroneous?.flagged && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <p className="label mb-2 text-red-700">Marked Erroneous</p>
                <p className="text-sm text-black/80 whitespace-pre-wrap break-all">{selectedSubmission.erroneous?.reason}</p>
                <p className="text-xs text-black/55 mt-2">Marked at {formatDateTime(selectedSubmission.erroneous?.markedAt)}</p>
              </div>
            )}

            {selectedSubmission.discarded?.flagged && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <p className="label mb-2 text-red-700">Discarded</p>
                <p className="text-sm text-black/80">The annotator discarded this item from the edit screen.</p>
                {selectedSubmission.discarded?.discardedAt && (
                  <p className="text-xs text-black/55 mt-2">Discarded at {formatDateTime(selectedSubmission.discarded.discardedAt)}</p>
                )}
              </div>
            )}

            {selectedSubmission.reportedIssue?.flagged && (
              <div className="rounded-2xl border border-[#d3b9b1] bg-[#f8efec] p-4">
                <p className="label mb-2 text-[#8d3d2e]">User's Flag Reason</p>
                <p className="text-sm text-black/80 whitespace-pre-wrap break-all">{selectedSubmission.reportedIssue?.note || "No reason provided."}</p>
                {selectedSubmission.reportedIssue?.adminComment && (
                  <p className="text-xs text-black/60 mt-2">Admin comment: {selectedSubmission.reportedIssue.adminComment}</p>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-[#c7d1c3] bg-[#eef2ec] p-4">
              <p className="label mb-2">Audio</p>
              {audioLoading ? (
                <Spinner size="sm" />
              ) : audioUrl ? (
                <>
                  <audio controls src={audioUrl} className="w-full" />
                  <p className="text-xs text-black/55 mt-2">
                    {formatDuration(selectedSubmission.audio?.durationSeconds)} · {formatFileSize(selectedSubmission.audio?.fileSizeBytes)} · {selectedSubmission.audio?.sampleRate} Hz · {selectedSubmission.audio?.bitDepth}-bit · Uploaded {formatDateTime(selectedSubmission.audio?.uploadedAt)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-black/60">No audio recorded yet.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
