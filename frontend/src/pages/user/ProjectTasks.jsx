import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Grid3x3, List, Mic2 } from "lucide-react";
import toast from "react-hot-toast";
import DataTable from "datatables.net-dt";
import "datatables.net-dt/css/dataTables.dataTables.css";
import UserLayout from "../../components/layout/UserLayout";
import { getProjectTasks } from "../../api/user.api";
import { PageSpinner } from "../../components/ui/Spinner";
import StatusBadge from "../../utils/statusBadge";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "in-progress", label: "In progress" },
  { key: "verified", label: "Verified" },
  { key: "corrected", label: "Corrected" },
  { key: "completed", label: "Completed" },
  { key: "discarded", label: "Discarded" },
  { key: "skipped", label: "Skipped" },
];

const VIEW_STORAGE_KEY = "bolo.user.projectTasks.view";
const FILTER_STORAGE_KEY = "bolo.user.projectTasks.filter";

export default function ProjectTasks() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_STORAGE_KEY) || "grid"; } catch { return "grid"; }
  });
  const [statusFilter, setStatusFilter] = useState(() => {
    try { return localStorage.getItem(FILTER_STORAGE_KEY) || "all"; } catch { return "all"; }
  });

  const tableRef = useRef(null);
  const dataTableInstanceRef = useRef(null);

  useEffect(() => {
    getProjectTasks(id)
      .then((r) => {
        setProject(r.data.data.project);
        setTasks(r.data.data.tasks || []);
      })
      .catch((err) => {
        toast.error(err.response?.data?.message || "Failed to load project tasks");
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* ignore */ }
  }, [view]);
  useEffect(() => {
    try { localStorage.setItem(FILTER_STORAGE_KEY, statusFilter); } catch { /* ignore */ }
  }, [statusFilter]);

  const filteredTasks = useMemo(() => {
    if (statusFilter === "all") return tasks;
    return tasks.filter((t) => (t.status || "pending") === statusFilter);
  }, [tasks, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = { all: tasks.length };
    tasks.forEach((t) => {
      const s = t.status || "pending";
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [tasks]);

  // DataTables lifecycle - init on view=table, destroy on view=grid or unmount.
  useEffect(() => {
    if (view !== "table" || !tableRef.current || !filteredTasks.length) {
      if (dataTableInstanceRef.current) {
        dataTableInstanceRef.current.destroy();
        dataTableInstanceRef.current = null;
      }
      return undefined;
    }
    if (dataTableInstanceRef.current) {
      dataTableInstanceRef.current.destroy();
      dataTableInstanceRef.current = null;
    }
    dataTableInstanceRef.current = new DataTable(tableRef.current, {
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100],
      order: [[0, "asc"]],
      autoWidth: false,
      responsive: false,
      language: {
        search: "Search:",
        lengthMenu: "_MENU_ tasks per page",
        paginate: { previous: "Prev", next: "Next" },
        emptyTable: "No tasks match this filter",
      },
      columnDefs: [
        { targets: -1, orderable: false, searchable: false }, // Action column
      ],
      dom: '<"dt-toolbar"lf>rt<"dt-footer"ip>',
    });
    return () => {
      if (dataTableInstanceRef.current) {
        dataTableInstanceRef.current.destroy();
        dataTableInstanceRef.current = null;
      }
    };
  }, [view, filteredTasks]);

  if (loading) {
    return <UserLayout><PageSpinner /></UserLayout>;
  }

  return (
    <UserLayout>
      <Link to="/user" className="flex items-center gap-1.5 text-sm text-black/70 hover:text-black mb-6 transition">
        <ChevronLeft size={16} /> Back to Projects
      </Link>

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

      {/* Status filter chips (grid + table both) */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition ${
                active
                  ? "bg-primary-700 text-white"
                  : "bg-white border border-primary-100 text-primary-800 hover:bg-primary-50"
              }`}
            >
              {f.label}
              <span className={`inline-block min-w-[18px] text-center rounded-full px-1.5 ${
                active ? "bg-white/20 text-white" : "bg-primary-100 text-primary-800"
              }`}>{statusCounts[f.key] || 0}</span>
            </button>
          );
        })}
      </div>

      {tasks.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <Mic2 size={40} className="text-primary-300 mb-4" />
          <p className="text-primary-500 font-medium">No tasks assigned in this project.</p>
          <p className="text-primary-300 text-sm mt-1">Contact your admin if you expected tasks here.</p>
        </div>
      ) : view === "grid" ? (
        filteredTasks.length === 0 ? (
          <div className="card py-12 text-center text-primary-500">
            No tasks match this filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredTasks.map((t) => (
              <div
                key={t._id}
                onClick={() => navigate(`/user/tasks/${t._id}`)}
                className="bg-[#e3e7e3] rounded-2xl p-4 shadow-sm border border-[#b9c1b8] cursor-pointer hover:bg-[#dce1dc] transition group"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <span className="font-mono text-xs text-black/70 bg-black/5 px-2 py-0.5 rounded">
                    {t.taskId}
                  </span>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/user/tasks/${t._id}`);
                    }}
                    className="px-4 py-1.5 rounded-xl bg-primary-700 hover:bg-primary-800 !text-white text-xs font-semibold transition"
                  >
                    Continue
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table ref={tableRef} className="w-full text-sm display">
            <thead>
              <tr className="border-b border-primary-100 bg-primary-50/40">
                <th className="text-left px-3 py-2 text-xs font-semibold text-black/60 uppercase tracking-wide">Task ID</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-black/60 uppercase tracking-wide">Dialogue ID</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-black/60 uppercase tracking-wide">Chinese</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-black/60 uppercase tracking-wide">Pinyin</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-black/60 uppercase tracking-wide">Status</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-black/60 uppercase tracking-wide">Audio</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-black/60 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((t) => {
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
              {!filteredTasks.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-black/60">
                    <Mic2 size={28} className="mx-auto mb-2 opacity-30" />
                    No tasks match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </UserLayout>
  );
}
