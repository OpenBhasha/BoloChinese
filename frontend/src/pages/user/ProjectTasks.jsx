import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Grid3x3, List, Mic2 } from "lucide-react";
import toast from "react-hot-toast";
import UserLayout from "../../components/layout/UserLayout";
import { getProjectTasks, getProjectTaskSummary } from "../../api/user.api";
import { PageSpinner } from "../../components/ui/Spinner";
import PaginationControls from "../../components/admin/PaginationControls";
import StatusBadge from "../../utils/statusBadge";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "in-progress", label: "In progress" },
  { key: "verified", label: "Verified" },
  { key: "corrected", label: "Corrected" },
  { key: "completed", label: "Completed" },
  { key: "discarded", label: "Discarded" },
];

const PAGE_SIZE = 24;
const VIEW_STORAGE_KEY = "bolo.user.projectTasks.view";
const FILTER_STORAGE_KEY = "bolo.user.projectTasks.filter";

export default function ProjectTasks() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [summary, setSummary] = useState({ total: 0, byStatus: {} });
  const [firstLoad, setFirstLoad] = useState(true);
  const [listLoading, setListLoading] = useState(false);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_STORAGE_KEY) || "grid"; } catch { return "grid"; }
  });
  const [statusFilter, setStatusFilter] = useState(() => {
    try { return localStorage.getItem(FILTER_STORAGE_KEY) || "all"; } catch { return "all"; }
  });

  // Debounce the search box so keystrokes don't each hit the API. Resetting to
  // page 1 happens here (and in the filter handlers) rather than in an effect.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef(null);
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const pickFilter = (key) => { setStatusFilter(key); setPage(1); };

  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* ignore */ }
  }, [view]);
  useEffect(() => {
    try { localStorage.setItem(FILTER_STORAGE_KEY, statusFilter); } catch { /* ignore */ }
  }, [statusFilter]);

  // Chip counts + the page of tasks. Re-runs whenever project / page / filter /
  // search changes. The summary call is cheap and keeps the chips honest.
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setListLoading(true);
      try {
        const [listRes, sumRes] = await Promise.all([
          getProjectTasks(id, {
            page,
            limit: PAGE_SIZE,
            status: statusFilter === "all" ? undefined : statusFilter,
            search: debouncedSearch || undefined,
          }),
          getProjectTaskSummary(id).catch(() => null),
        ]);
        if (ignore) return;
        setProject(listRes.data.data.project);
        setTasks(listRes.data.data.tasks || []);
        setPagination(listRes.data.data.pagination || { page: 1, totalPages: 1, total: 0 });
        if (sumRes) setSummary(sumRes.data.data || { total: 0, byStatus: {} });
      } catch (err) {
        if (!ignore) toast.error(err.response?.data?.message || "Failed to load project tasks");
      } finally {
        if (!ignore) { setListLoading(false); setFirstLoad(false); }
      }
    };
    load();
    return () => { ignore = true; };
  }, [id, page, statusFilter, debouncedSearch]);

  const chipCount = (key) =>
    key === "all" ? summary.total : summary.byStatus?.[key] ?? 0;

  if (firstLoad) {
    return <UserLayout><PageSpinner /></UserLayout>;
  }

  const emptyProject = summary.total === 0 && !debouncedSearch && statusFilter === "all";

  return (
    <UserLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-primary-900">{project?.name || "Project"}</h1>
        <div className="inline-flex rounded-lg border border-primary-100 bg-white p-1">
          <button
            type="button"
            onClick={() => setView("grid")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md inline-flex items-center gap-1.5 transition ${
              view === "grid" ? "bg-primary-700 text-white" : "text-primary-800 hover:bg-primary-50"
            }`}
          >
            <Grid3x3 size={14} /> Grid
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md inline-flex items-center gap-1.5 transition ${
              view === "table" ? "bg-primary-700 text-white" : "text-primary-800 hover:bg-primary-50"
            }`}
          >
            <List size={14} /> Table
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => pickFilter(f.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition ${
                  active
                    ? "bg-primary-700 text-white"
                    : "bg-white border border-primary-100 text-primary-800 hover:bg-primary-50"
                }`}
              >
                {f.label}
                <span className={`inline-block min-w-[18px] text-center rounded-full px-1.5 ${
                  active ? "bg-white/20 text-white" : "bg-primary-100 text-primary-800"
                }`}>{chipCount(f.key)}</span>
              </button>
            );
          })}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search task / dialogue…"
          className="input w-full sm:w-64"
        />
      </div>

      {emptyProject ? (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <Mic2 size={40} className="text-primary-300 mb-4" />
          <p className="text-primary-500 font-medium">No tasks assigned in this project.</p>
          <p className="text-primary-300 text-sm mt-1">Contact your admin if you expected tasks here.</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="card py-12 text-center text-primary-500">
          {listLoading ? "Loading…" : "No tasks match this filter."}
        </div>
      ) : view === "grid" ? (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${listLoading ? "opacity-60" : ""}`}>
          {tasks.map((t) => (
            <div
              key={t._id}
              onClick={() => navigate(`/user/tasks/${t._id}`)}
              className="bg-[#e3e7e3] rounded-2xl p-4 shadow-sm border border-[#b9c1b8] cursor-pointer hover:bg-[#dce1dc] transition group"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <span className="font-mono text-xs text-black/70 bg-black/5 px-2 py-0.5 rounded">{t.taskId}</span>
                <StatusBadge status={t.status} />
              </div>
              <p className="text-base font-semibold text-black mb-1 line-clamp-1">{t.dialogueId}</p>
              <p className="text-sm text-black/80 mb-3 line-clamp-2">{t.correctedChineseTranscript || t.chineseTranscript}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-black/75">
                  {(t.audio?.publicId || t.audio?.url)
                    ? <span className="text-black font-medium flex items-center gap-1"><Mic2 size={11} /> Audio recorded</span>
                    : <span>Audio pending</span>}
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); navigate(`/user/tasks/${t._id}`); }}
                  className="px-4 py-1.5 rounded-xl bg-primary-700 hover:bg-primary-800 !text-white text-xs font-semibold transition"
                >
                  Continue
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`card p-0 overflow-x-auto ${listLoading ? "opacity-60" : ""}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary-100 bg-primary-50/40">
                {["Task ID", "Dialogue ID", "Chinese", "Pinyin", "Status", "Audio", "Action"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-black/60 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const chinese = t.correctedChineseTranscript || t.chineseTranscript;
                const pinyin = t.correctedPinyin || t.pinyin;
                const hasAudio = Boolean(t.audio?.publicId || t.audio?.url);
                return (
                  <tr key={t._id} className="border-b border-primary-50 hover:bg-primary-50/40 transition">
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[11px] text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">{t.taskId}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-black/80">{t.dialogueId}</td>
                    <td className="px-3 py-2.5 text-xs text-black/80 max-w-xs truncate" title={chinese}>{chinese}</td>
                    <td className="px-3 py-2.5 text-xs text-black/70 max-w-xs truncate" title={pinyin}>{pinyin}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={t.status} /></td>
                    <td className="px-3 py-2.5 text-xs">{hasAudio ? "✓" : "-"}</td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => navigate(`/user/tasks/${t._id}`)}
                        className="px-3 py-1 rounded-md bg-primary-700 hover:bg-primary-800 !text-white text-[11px] font-semibold transition"
                      >
                        Continue
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="mt-4">
          <PaginationControls
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
          />
        </div>
      )}
    </UserLayout>
  );
}
