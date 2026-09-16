import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import AdminLayout from "../../components/layout/AdminLayout";
import Modal from "../../components/ui/Modal";
import {
  getProjectById,
  createTask,
  updateTask,
  deleteTask,
  bulkDeleteTasks,
  getTasksByProject,
  getTaskById,
  getTaskSubmissions,
  getProjectSubmissions,
  streamSubmissionAudio,
  deleteSubmission,
  uploadTasksImport,
  downloadTaskTemplate,
  exportProjectResults,
  getProjectAssignees,
} from "../../api/admin.api";
import { Plus, Trash2, Pencil, ChevronLeft, Mic2, FileAudio, FileText, User2, CalendarClock, Upload, Download, FileDown } from "lucide-react";
import { PageSpinner, Spinner } from "../../components/ui/Spinner";
import PaginationControls from "../../components/admin/PaginationControls";
import ProjectResetDangerZone from "../../components/admin/ProjectResetDangerZone";
import { formatDateTime, formatFileSize, downloadBlob } from "../../utils/format";
import toast from "react-hot-toast";

const EMPTY_TASK = { dialogueId: "", chineseTranscript: "", pinyin: "", assignedTo: "" };
const ADMIN_PROJECT_VIEWS = {
  TASKS: "tasks",
  SUBMISSIONS: "submissions",
  USERS: "users",
};

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState(ADMIN_PROJECT_VIEWS.SUBMISSIONS);
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_TASK);
  const [saving, setSaving] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [submissionItems, setSubmissionItems] = useState([]);
  const [submissionPagination, setSubmissionPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [submissionSearchDebounced, setSubmissionSearchDebounced] = useState("");
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [taskSubmissions, setTaskSubmissions] = useState([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("");
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [submissionAudioUrl, setSubmissionAudioUrl] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [exportingResults, setExportingResults] = useState(false);
  // Tasks tab: server-paginated list + selection (one/more on this page, or
  // every task matching the project via selectAllMatching).
  const [taskItems, setTaskItems] = useState([]);
  const [taskPagination, setTaskPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [taskPage, setTaskPage] = useState(1);
  const [taskSearch, setTaskSearch] = useState("");
  const [taskSearchDebounced, setTaskSearchDebounced] = useState("");
  const [tasksLoading, setTasksLoading] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [projectAssignees, setProjectAssignees] = useState([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [submissionSearch, setSubmissionSearch] = useState("");
  const [submissionPage, setSubmissionPage] = useState(1);
  const excelInputRef = useRef(null);

  const fetchProject = () => {
    getProjectById(id)
      .then((pr) => setProject(pr.data.data))
      .catch(() => toast.error("Failed to load project"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchProject(); }, [id]);

  useEffect(() => () => {
    if (submissionAudioUrl) {
      URL.revokeObjectURL(submissionAudioUrl);
    }
  }, [submissionAudioUrl]);

  // Debounce the submissions search box.
  useEffect(() => {
    const t = setTimeout(() => setSubmissionSearchDebounced(submissionSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [submissionSearch]);

  // Reset to page 1 when the search term changes.
  useEffect(() => { setSubmissionPage(1); }, [submissionSearchDebounced]);

  useEffect(() => {
    if (activeView === ADMIN_PROJECT_VIEWS.TASKS) {
      setSubmissionsLoading(false);
      return undefined;
    }
    if (!project) return undefined;
    if ((project.taskCount || 0) === 0) {
      setSubmissionItems([]);
      setSubmissionPagination({ page: 1, totalPages: 1, total: 0 });
      setSubmissionsLoading(false);
      return undefined;
    }

    let ignore = false;
    setSubmissionsLoading(true);

    // Server-paginated: one page of recordings (hasAudio) for this project,
    // filtered + sorted in Mongo. No more "fetch every submission, group and
    // paginate on the client".
    getProjectSubmissions(id, {
      page: submissionPage,
      limit: 20,
      search: submissionSearchDebounced || undefined,
      hasAudio: true,
    })
      .then((res) => {
        if (ignore) return;
        const data = res.data.data || {};
        setSubmissionItems(data.items || []);
        setSubmissionPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
      })
      .catch(() => {
        if (!ignore) {
          setSubmissionItems([]);
          setSubmissionPagination({ page: 1, totalPages: 1, total: 0 });
        }
      })
      .finally(() => {
        if (!ignore) setSubmissionsLoading(false);
      });

    return () => { ignore = true; };
  }, [project, activeView, id, submissionPage, submissionSearchDebounced]);

  useEffect(() => {
    if (activeView === ADMIN_PROJECT_VIEWS.TASKS && submissionSearch) {
      setSubmissionSearch("");
    }
  }, [activeView, submissionSearch]);

  // Debounce the tasks search box.
  useEffect(() => {
    const t = setTimeout(() => setTaskSearchDebounced(taskSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [taskSearch]);

  // Reset to page 1 and drop any cross-page "select all" when the search changes.
  useEffect(() => {
    setTaskPage(1);
    setSelectAllMatching(false);
  }, [taskSearchDebounced]);

  // One page of this project's tasks, server-sorted/filtered/paginated - same
  // pattern as the Submissions tab above.
  const fetchTasks = () => {
    setTasksLoading(true);
    return getTasksByProject(id, {
      page: taskPage,
      limit: 20,
      search: taskSearchDebounced || undefined,
    })
      .then((res) => {
        const data = res.data.data || {};
        setTaskItems(data.tasks || []);
        setTaskPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
      })
      .catch(() => {
        setTaskItems([]);
        setTaskPagination({ page: 1, totalPages: 1, total: 0 });
      })
      .finally(() => setTasksLoading(false));
  };

  useEffect(() => {
    if (activeView !== ADMIN_PROJECT_VIEWS.TASKS) return;
    if (!project) return;
    if ((project.taskCount || 0) === 0) {
      setTaskItems([]);
      setTaskPagination({ page: 1, totalPages: 1, total: 0 });
      return;
    }
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, activeView, id, taskPage, taskSearchDebounced]);

  // Selection never survives a page/search change - re-pick per page instead
  // of trying to track ids across server-paginated results.
  useEffect(() => {
    setSelectedTaskIds(new Set());
    setSelectAllMatching(false);
  }, [taskPage, taskSearchDebounced]);

  const allOnPageSelected = taskItems.length > 0 && taskItems.every((t) => selectedTaskIds.has(t._id));
  const selectedCount = selectAllMatching ? taskPagination.total : selectedTaskIds.size;

  const toggleSelectTask = (taskId) => {
    if (selectAllMatching) return;
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectAllMatching(false);
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        taskItems.forEach((t) => next.delete(t._id));
      } else {
        taskItems.forEach((t) => next.add(t._id));
      }
      return next;
    });
  };

  const openEdit = (t) => {
    setForm({ dialogueId: t.dialogueId, chineseTranscript: t.chineseTranscript, pinyin: t.pinyin, assignedTo: t.assignedTo?._id || "" });
    setEditing(t); setModal("form");
  };

  const closeSubmissionModal = () => {
    setModal(null);
    setSelectedTask(null);
    setTaskSubmissions([]);
    setSelectedSubmissionId("");
    if (submissionAudioUrl) {
      URL.revokeObjectURL(submissionAudioUrl);
      setSubmissionAudioUrl(null);
    }
  };

  const openSubmission = async (taskId, { preferredSubmissionId } = {}) => {
    setModal("submission");
    setSubmissionLoading(true);
    setSelectedTask(null);
    setTaskSubmissions([]);
    setSelectedSubmissionId("");

    if (submissionAudioUrl) {
      URL.revokeObjectURL(submissionAudioUrl);
      setSubmissionAudioUrl(null);
    }

    try {
      const [taskResponse, submissionsResponse] = await Promise.all([
        getTaskById(taskId),
        getTaskSubmissions(taskId),
      ]);
      const taskData = taskResponse.data.data;
      const submissions = submissionsResponse.data.data || [];
      setSelectedTask(taskData);
      setTaskSubmissions(submissions);

      if (submissions.length) {
        const selectedById = preferredSubmissionId
          ? submissions.find((submission) => submission._id === preferredSubmissionId)
          : null;
        const firstAudioSubmission = submissions.find((submission) => submission.audio?.publicId || submission.audio?.url);
        const initialSubmission = selectedById || firstAudioSubmission || submissions[0];

        setSelectedSubmissionId(initialSubmission._id);
        if (initialSubmission.audio?.publicId || initialSubmission.audio?.url) {
          const audioResponse = await streamSubmissionAudio(initialSubmission._id);
          const audioBlobUrl = URL.createObjectURL(audioResponse.data);
          setSubmissionAudioUrl(audioBlobUrl);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load task submission");
      closeSubmissionModal();
    } finally {
      setSubmissionLoading(false);
    }
  };

  const selectedSubmission = taskSubmissions.find((s) => s._id === selectedSubmissionId) || null;

  // The server hands back one page of recordings, each with taskId / userId
  // populated. Shape it to the { task, submission } rows the table renders.
  const paginatedSubmissionRows = useMemo(
    () =>
      submissionItems.map((submission) => ({
        task: submission.taskId && typeof submission.taskId === "object"
          ? submission.taskId
          : { _id: submission.taskId },
        submission,
      })),
    [submissionItems]
  );
  const currentSubmissionPage = submissionPagination.page || 1;
  const totalSubmissionPages = submissionPagination.totalPages || 1;

  useEffect(() => {
    if (activeView === ADMIN_PROJECT_VIEWS.SUBMISSIONS) {
      setSubmissionPage(1);
    }
  }, [activeView]);

  // Load assignees when the Users tab opens.
  useEffect(() => {
    if (activeView !== ADMIN_PROJECT_VIEWS.USERS) return;
    let cancelled = false;
    setAssigneesLoading(true);
    getProjectAssignees(id)
      .then((r) => { if (!cancelled) setProjectAssignees(r.data.data || []); })
      .catch((err) => { if (!cancelled) toast.error(err.response?.data?.message || "Failed to load users"); })
      .finally(() => { if (!cancelled) setAssigneesLoading(false); });
    return () => { cancelled = true; };
  }, [activeView, id]);

  // After a project-level reset: refetch the header (taskCount) and, if the
  // Tasks or Users tab is open, its own list too. The Submissions list effect
  // already re-runs on its own once `project` changes.
  const handleProjectReset = async () => {
    fetchProject();
    if (activeView === ADMIN_PROJECT_VIEWS.TASKS) {
      setSelectedTaskIds(new Set());
      setSelectAllMatching(false);
      setTaskPage(1);
    }
    if (activeView === ADMIN_PROJECT_VIEWS.USERS) {
      setAssigneesLoading(true);
      try {
        const r = await getProjectAssignees(id);
        setProjectAssignees(r.data.data || []);
      } catch {
        // non-fatal - the effect above retries next time the tab opens
      } finally {
        setAssigneesLoading(false);
      }
    }
  };

  const runBulkDelete = async () => {
    if (!selectedCount) return;
    setBulkDeleting(true);
    try {
      const payload = selectAllMatching ? { all: true } : { ids: Array.from(selectedTaskIds) };
      const res = await bulkDeleteTasks(id, payload);
      toast.success(`Deleted ${res.data.data.deletedCount} task(s).`);
      setSelectedTaskIds(new Set());
      setSelectAllMatching(false);
      setConfirmBulkDelete(false);
      fetchProject();
      await fetchTasks(); // re-pull this page with the current filters
    } catch (err) {
      toast.error(err.response?.data?.message || "Bulk delete failed.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      // Clean up form data - remove empty assignedTo
      const cleanForm = { ...form };
      if (!cleanForm.assignedTo || cleanForm.assignedTo === "") {
        delete cleanForm.assignedTo;
      }

      if (editing) { await updateTask(editing._id, cleanForm); toast.success("Task updated!"); }
      else { await createTask(id, cleanForm); toast.success("Task created!"); }
      setModal(null);
      fetchProject();
      fetchTasks();
    } catch (err) {
      const errs = err.response?.data?.errors;
      if (errs) errs.forEach((e) => toast.error(e.message));
      else toast.error(err.response?.data?.message || "Failed");
    } finally { setSaving(false); }
  };

  const handleDelete = async (tid) => {
    if (!confirm("Delete this task?")) return;
    try {
      await deleteTask(tid);
      toast.success("Task deleted");
      fetchProject();
      fetchTasks();
    } catch {
      toast.error("Delete failed");
    }
  };

  const handleDeleteSubmission = async (taskId, submission) => {
    if (!submission?._id) return;
    if (!confirm("Delete this submission?")) return;

    try {
      await deleteSubmission(submission._id);

      setSubmissionItems((prev) => prev.filter((item) => item._id !== submission._id));
      setTaskSubmissions((prev) => prev.filter((item) => item._id !== submission._id));

      if (selectedSubmissionId === submission._id) {
        closeSubmissionModal();
      }

      toast.success("Submission deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const handleExcelSelection = async (event) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";
    if (!selectedFile) return;

    setBulkUploading(true);
    try {
      const response = await uploadTasksImport(id, selectedFile);
      const result = response.data?.data;
      const message = response.data?.message || "Tasks imported.";
      toast.success(message);

      if (result?.errors?.length) {
        const previewErrors = result.errors.slice(0, 5)
          .map((item) => `Row ${item.row}: ${item.message}`)
          .join("\n");
        toast.error(`Some rows were skipped:\n${previewErrors}`);
      }

      fetchProject();
    } catch (err) {
      const errs = err.response?.data?.errors;
      if (errs?.length) {
        errs.forEach((e) => toast.error(e.message));
      } else {
        toast.error(err.response?.data?.message || "Import failed");
      }
    } finally {
      setBulkUploading(false);
    }
  };

  const handleExportResults = async () => {
    setExportingResults(true);
    try {
      const response = await exportProjectResults(id);
      const name = response.headers?.["content-disposition"]?.match(/filename="?([^"]+)"?/)?.[1]
        || `bolo-results-${id}.csv`;
      downloadBlob(response.data, name);
      toast.success("Results exported (partial results included).");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to export results");
    } finally {
      setExportingResults(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      const response = await downloadTaskTemplate();
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "Template.xlsx");
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success("Template downloaded successfully");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to download template");
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleViewChange = (nextView) => {
    setActiveView(nextView);
    if (nextView === ADMIN_PROJECT_VIEWS.SUBMISSIONS) {
      setSubmissionPage(1);
    }
    if (nextView === ADMIN_PROJECT_VIEWS.TASKS) {
      setTaskPage(1);
    }
  };

  return (
    <AdminLayout>
      <Link to="/admin/projects" className="flex items-center gap-1.5 text-sm text-black/70 hover:text-black mb-6 transition">
        <ChevronLeft size={16} /> Back to Projects
      </Link>

      {loading ? <PageSpinner /> : (
        <>
          <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-primary-900 mb-1">{project?.name}</h1>
              <p className="text-primary-500 text-sm">{project?.description || "No description"}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end w-full md:w-auto">
              <div className="inline-flex rounded-lg border border-[#c3cdc0] bg-white p-1 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => handleViewChange(ADMIN_PROJECT_VIEWS.TASKS)}
                  className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-semibold rounded-md border border-transparent transition ${
                    activeView === ADMIN_PROJECT_VIEWS.TASKS
                      ? "bg-[#dbe7d8] text-black border-[#b9c8b3]"
                      : "bg-transparent text-black hover:bg-[#eef4ec]"
                  }`}
                >
                  Tasks
                </button>
                <button
                  type="button"
                  onClick={() => handleViewChange(ADMIN_PROJECT_VIEWS.SUBMISSIONS)}
                  className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-semibold rounded-md border border-transparent transition ${
                    activeView === ADMIN_PROJECT_VIEWS.SUBMISSIONS
                      ? "bg-[#dbe7d8] text-black border-[#b9c8b3]"
                      : "bg-transparent text-black hover:bg-[#eef4ec]"
                  }`}
                >
                  Submissions
                </button>
                <button
                  type="button"
                  onClick={() => handleViewChange(ADMIN_PROJECT_VIEWS.USERS)}
                  className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-semibold rounded-md border border-transparent transition ${
                    activeView === ADMIN_PROJECT_VIEWS.USERS
                      ? "bg-[#dbe7d8] text-black border-[#b9c8b3]"
                      : "bg-transparent text-black hover:bg-[#eef4ec]"
                  }`}
                >
                  Users
                </button>
              </div>

              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleExcelSelection}
              />
              <button
                onClick={handleDownloadTemplate}
                className="btn-secondary flex items-center justify-center gap-2 w-full sm:w-auto"
                disabled={downloadingTemplate}
                title="Download the Excel template with dialogue_id, chinese_transcript, and pinyin columns"
              >
                <Download size={16} /> {downloadingTemplate ? "Downloading..." : "Download Template"}
              </button>
              <button
                onClick={() => excelInputRef.current?.click()}
                className="btn-secondary flex items-center justify-center gap-2 w-full sm:w-auto"
                disabled={bulkUploading}
                title="Upload an Excel or CSV file with dialogue_id, chinese_transcript, and pinyin columns"
              >
                <Upload size={16} /> {bulkUploading ? "Uploading..." : "Upload Tasks"}
              </button>
              <button
                onClick={handleExportResults}
                className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto"
                disabled={exportingResults}
                title="Export all results for this project as CSV"
              >
                <FileDown size={16} /> {exportingResults ? "Exporting..." : "Export"}
              </button>
            </div>
          </div>

          <ProjectResetDangerZone projectId={id} projectName={project?.name} onReset={handleProjectReset} />

          {activeView === ADMIN_PROJECT_VIEWS.TASKS ? (
            <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-black/60">
                {selectAllMatching ? (
                  <span className="font-semibold text-red-700">
                    All {taskPagination.total} task{taskPagination.total === 1 ? "" : "s"} in this project selected.{" "}
                    <button type="button" className="underline" onClick={() => { setSelectAllMatching(false); setSelectedTaskIds(new Set()); }}>
                      Clear selection
                    </button>
                  </span>
                ) : selectedTaskIds.size > 0 && allOnPageSelected && taskPagination.total > taskItems.length ? (
                  <span>
                    All {taskItems.length} tasks on this page are selected.{" "}
                    <button type="button" className="underline text-primary-800" onClick={() => setSelectAllMatching(true)}>
                      Select all {taskPagination.total} tasks in this project
                    </button>
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                {selectedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmBulkDelete(true)}
                    disabled={bulkDeleting}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-60"
                  >
                    <Trash2 size={12} /> Delete {selectedCount === taskPagination.total ? "all" : selectedCount}
                  </button>
                )}
                <input
                  type="text"
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search tasks…"
                  className="input w-full sm:w-64"
                />
              </div>
            </div>
          ) : activeView === ADMIN_PROJECT_VIEWS.SUBMISSIONS ? (
            <div className="mb-3 flex justify-end">
              <input
                type="text"
                value={submissionSearch}
                onChange={(e) => setSubmissionSearch(e.target.value)}
                placeholder="Search submissions…"
                className="input w-full sm:w-64"
              />
            </div>
          ) : null}

          <div className="admin-datatable card p-0 overflow-hidden border border-[#c3cdc0] shadow-sm">
            <div className="sm:hidden divide-y divide-[#d2dad0]">
              {activeView === ADMIN_PROJECT_VIEWS.TASKS ? (
                <>
                  {tasksLoading && !taskItems.length ? (
                    <div className="px-4 py-12 text-center text-black/60 space-y-3">
                      <Spinner />
                      <p className="text-sm">Loading tasks…</p>
                    </div>
                  ) : taskItems.length ? (
                    taskItems.map((t) => (
                      <div key={t._id} className={`p-4 space-y-2 hover:bg-primary-50/70 transition ${selectedTaskIds.has(t._id) || selectAllMatching ? "bg-primary-50" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              aria-label={`Select task ${t.taskId}`}
                              checked={selectAllMatching || selectedTaskIds.has(t._id)}
                              disabled={selectAllMatching}
                              onChange={() => toggleSelectTask(t._id)}
                            />
                            <span className="font-mono text-xs text-primary-700 bg-primary-100 px-2 py-0.5 rounded truncate">{t.taskId}</span>
                            <span className="text-[10px] capitalize text-black/60">{t.overallStatus || "pending"}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openSubmission(t._id)}
                            className="text-[11px] text-primary-800 hover:text-primary-900"
                          >
                            Details
                          </button>
                        </div>
                        <p className="text-xs text-black/80 bg-white border border-[#d1d9ce] px-2 py-0.5 rounded w-fit">{t.dialogueId}</p>
                        <p className="text-xs text-black/80 line-clamp-2">{t.chineseTranscript}</p>
                        <div className="flex justify-end gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEdit(t)}
                            className="px-2 py-1.5 rounded bg-[#dbe7d8] text-black hover:bg-[#c7d7c4] transition text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            <Pencil size={13} /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(t._id)}
                            className="px-2 py-1.5 rounded hover:bg-red-100 text-black/70 hover:text-red-700 transition text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            <Trash2 size={13} /> Delete
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-12 text-center text-black/60">
                      <Mic2 size={32} className="mx-auto mb-2 opacity-30" />
                      {taskSearchDebounced ? "No tasks match your search." : "No tasks yet."}
                    </div>
                  )}
                  {taskPagination.totalPages > 1 && (
                    <PaginationControls
                      currentPage={taskPagination.page || 1}
                      totalPages={taskPagination.totalPages || 1}
                      onPrev={() => setTaskPage((prev) => Math.max(1, prev - 1))}
                      onNext={() => setTaskPage((prev) => Math.min(taskPagination.totalPages, prev + 1))}
                      className="bg-white"
                    />
                  )}
                </>
              ) : activeView === ADMIN_PROJECT_VIEWS.SUBMISSIONS ? (
                <>
                  {submissionsLoading && !paginatedSubmissionRows.length ? (
                    <div className="px-4 py-12 text-center text-black/60 space-y-3">
                      <Spinner />
                      <p className="text-sm">Loading submissions…</p>
                    </div>
                  ) : paginatedSubmissionRows.length ? (
                    paginatedSubmissionRows.map(({ task: rowTask, submission }) => (
                      <div key={submission._id} className="p-4 space-y-2 hover:bg-primary-50/70 transition">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-primary-700 bg-primary-100 px-2 py-0.5 rounded truncate">{rowTask.taskId}</span>
                        </div>
                        <p className="text-xs text-black/80 bg-white border border-[#d1d9ce] px-2 py-0.5 rounded w-fit">{rowTask.dialogueId}</p>
                        <div>
                          <p className="text-sm text-black/80">{submission.userId?.name || "Unknown user"}</p>
                          <p className="text-[11px] text-black/60">{submission.userId?.email || "no-email"}</p>
                        </div>
                        <div className="text-xs text-black/70 font-semibold">Status: {submission.status || "pending"}</div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openSubmission(rowTask._id, { preferredSubmissionId: submission._id })}
                            className="text-[11px] font-semibold text-primary-800 hover:text-primary-900"
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSubmission(rowTask._id, submission)}
                            className="px-2 py-1 rounded border border-transparent hover:bg-red-100 text-black/70 hover:text-red-700 transition text-[11px] font-semibold inline-flex items-center gap-1 "
                          >
                            <Trash2 size={13} /> Delete
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-12 text-center text-black/60">
                      <Mic2 size={32} className="mx-auto mb-2 opacity-30" />
                      {submissionSearchDebounced ? "No submissions match your search." : "No submissions recorded yet."}
                    </div>
                  )}
                  {totalSubmissionPages > 1 && (
                    <PaginationControls
                      currentPage={currentSubmissionPage}
                      totalPages={totalSubmissionPages}
                      onPrev={() => setSubmissionPage((prev) => Math.max(1, prev - 1))}
                      onNext={() => setSubmissionPage((prev) => Math.min(totalSubmissionPages, prev + 1))}
                      className="bg-white"
                    />
                  )}
                </>
              ) : null}
              {activeView === ADMIN_PROJECT_VIEWS.USERS && (
                <>
                  {assigneesLoading && !projectAssignees.length ? (
                    <div className="px-4 py-12 text-center text-black/60 space-y-3">
                      <Spinner />
                      <p className="text-sm">Loading assignees…</p>
                    </div>
                  ) : projectAssignees.length ? (
                    projectAssignees.map(({ user, stats }) => (
                      <Link
                        key={user._id}
                        to={`/admin/users/${user._id}`}
                        className="block p-4 space-y-1.5 hover:bg-primary-50/70 transition"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-primary-800">{user.name || "Unknown user"}</p>
                          <span className={`text-[10px] font-semibold ${user.isVerified ? "text-emerald-700" : "text-amber-700"}`}>
                            {user.isVerified ? "Verified" : "Pending"}
                          </span>
                        </div>
                        <p className="font-mono text-[11px] text-black/60">{user.username || "-"}</p>
                        <p className="text-xs text-black/70 truncate">{user.email || "-"}</p>
                        <div className="text-[11px] text-black/70">
                          {stats.done}/{stats.totalTasks} completed · {stats.inProgress} in progress · {stats.discarded} discarded · {stats.pending} pending
                        </div>
                      </Link>
                    ))
                  ) : (
                    <div className="px-4 py-12 text-center text-black/60">
                      <User2 size={28} className="mx-auto mb-2 opacity-30" />
                      No annotators assigned yet.
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="hidden sm:block">
              {activeView === ADMIN_PROJECT_VIEWS.TASKS ? (
                <>
                  <table className="w-full text-sm table-fixed">
                    <thead>
                      <tr className="border-b border-[#d2dad0] bg-primary-50/70">
                        <th className="text-left px-2 py-3 w-[5%]">
                          <input
                            type="checkbox"
                            aria-label="Select all tasks on this page"
                            checked={selectAllMatching || allOnPageSelected}
                            disabled={selectAllMatching}
                            onChange={toggleSelectAllOnPage}
                          />
                        </th>
                        <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[13%]">Task ID</th>
                        <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[17%]">Dialogue ID</th>
                        <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[38%]">Chinese Transcript</th>
                        <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[12%]">Status</th>
                        <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[15%]">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasksLoading && !taskItems.length ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-black/60">
                            <Spinner />
                            <p className="mt-2 text-sm">Loading tasks…</p>
                          </td>
                        </tr>
                      ) : taskItems.length ? (
                        taskItems.map((t) => (
                          <tr key={t._id} className={`border-b border-[#d8e0d5] hover:bg-primary-50/60 transition ${selectAllMatching || selectedTaskIds.has(t._id) ? "bg-primary-50" : ""}`}>
                            <td className="px-2 py-3.5 w-[5%]">
                              <input
                                type="checkbox"
                                aria-label={`Select task ${t.taskId}`}
                                checked={selectAllMatching || selectedTaskIds.has(t._id)}
                                disabled={selectAllMatching}
                                onChange={() => toggleSelectTask(t._id)}
                              />
                            </td>
                            <td className="px-2 py-3.5 w-[13%]">
                              <span className="font-mono text-xs text-primary-700 bg-primary-100 px-1.5 py-0.5 rounded block truncate">{t.taskId}</span>
                            </td>
                            <td className="px-2 py-3.5 w-[17%]">
                              <span className="text-xs text-black/80 bg-white border border-[#d1d9ce] px-1.5 py-0.5 rounded block truncate">{t.dialogueId}</span>
                            </td>
                            <td className="px-2 py-3.5 w-[38%]">
                              <div className="text-black/80 text-xs truncate" title={t.chineseTranscript}>{t.chineseTranscript}</div>
                            </td>
                            <td className="px-2 py-3.5 w-[12%]">
                              <span className="text-[11px] capitalize text-black/75">{t.overallStatus || "pending"}</span>
                            </td>
                            <td className="px-2 py-3.5 w-[15%]">
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEdit(t)}
                                  className="px-2 py-1 rounded bg-[#dbe7d8] text-black hover:bg-[#c7d7c4] transition text-[11px] font-semibold inline-flex items-center gap-1"
                                  title="Edit task"
                                >
                                  <Pencil size={12} /> Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(t._id)}
                                  className="px-2 py-1 rounded border border-transparent hover:bg-red-100 text-black/70 hover:text-red-700 transition text-[11px] font-semibold inline-flex items-center gap-1"
                                  title="Delete task"
                                >
                                  <Trash2 size={12} /> Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-black/60">
                            <Mic2 size={32} className="mx-auto mb-2 opacity-30" />
                            {taskSearchDebounced ? "No tasks match your search." : "No tasks yet."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {taskPagination.totalPages > 1 && (
                    <PaginationControls
                      currentPage={taskPagination.page || 1}
                      totalPages={taskPagination.totalPages || 1}
                      onPrev={() => setTaskPage((prev) => Math.max(1, prev - 1))}
                      onNext={() => setTaskPage((prev) => Math.min(taskPagination.totalPages, prev + 1))}
                      className="bg-[#f6f9f3]"
                    />
                  )}
                </>
              ) : activeView === ADMIN_PROJECT_VIEWS.SUBMISSIONS ? (
                <>
                <table className="w-full text-sm table-fixed">
                  <thead>
                    <tr className="border-b border-[#d2dad0] bg-primary-50/70">
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[12%]">Task ID</th>
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[15%]">Dialogue ID</th>
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[25%]">User</th>
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[20%]">Status</th>
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[12%]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissionsLoading && !paginatedSubmissionRows.length ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-black/60">
                          <Spinner />
                          <p className="mt-2 text-sm">Loading submissions…</p>
                        </td>
                      </tr>
                    ) : paginatedSubmissionRows.length ? (
                      paginatedSubmissionRows.map(({ task: rowTask, submission }) => (
                        <tr
                          key={submission._id}
                          className="border-b border-[#d8e0d5] hover:bg-primary-50/60 transition cursor-pointer"
                          onClick={() => openSubmission(rowTask._id, { preferredSubmissionId: submission._id })}
                        >
                          <td className="px-2 py-3.5 w-[12%]">
                            <span className="font-mono text-xs text-primary-700 bg-primary-100 px-1.5 py-0.5 rounded block truncate">{rowTask.taskId}</span>
                          </td>
                          <td className="px-2 py-3.5 w-[15%]">
                            <span className="text-xs text-black/80 bg-white border border-[#d1d9ce] px-1.5 py-0.5 rounded block truncate">{rowTask.dialogueId}</span>
                          </td>
                          <td className="px-2 py-3.5 w-[25%]">
                            <div className="text-black/80 text-xs" title={submission.userId?.email}>
                              {submission.userId?.name || "Unknown user"}
                            </div>
                            <div className="text-black/55 text-[11px] truncate">{submission.userId?.email || "no-email"}</div>
                          </td>
                          <td className="px-2 py-3.5 w-[20%]">
                            <div className="text-black/80 text-xs capitalize">{submission.status || "pending"}</div>
                          </td>
                          <td className="px-2 py-3.5 w-[12%]">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSubmission(rowTask._id, { preferredSubmissionId: submission._id });
                                }}
                                className="text-[11px] font-semibold text-primary-800 hover:text-primary-900"
                                title="View submission details"
                              >
                                Details
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSubmission(rowTask._id, submission);
                                }}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-[#8d3d2e] hover:bg-red-100 hover:text-[#62291f] transition"
                              >
                                <Trash2 size={13} /> Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-black/60">
                          <Mic2 size={32} className="mx-auto mb-2 opacity-30" />
                          {submissionSearchDebounced ? "No submissions match your search." : "No submissions recorded yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {totalSubmissionPages > 1 && (
                  <PaginationControls
                    currentPage={currentSubmissionPage}
                    totalPages={totalSubmissionPages}
                    onPrev={() => setSubmissionPage((prev) => Math.max(1, prev - 1))}
                    onNext={() => setSubmissionPage((prev) => Math.min(totalSubmissionPages, prev + 1))}
                    className="bg-[#f6f9f3]"
                  />
                )}
                </>
              ) : activeView === ADMIN_PROJECT_VIEWS.USERS ? (
                <table className="w-full text-sm table-fixed">
                  <thead>
                    <tr className="border-b border-[#d2dad0] bg-primary-50/70">
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[25%]">Name</th>
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[18%]">Username</th>
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[25%]">Email</th>
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[10%]">Verified</th>
                      <th className="text-left px-2 py-3 text-xs font-semibold text-black/60 uppercase tracking-wide w-[22%]">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assigneesLoading && !projectAssignees.length ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-black/60">
                          <Spinner />
                          <p className="mt-2 text-sm">Loading assignees…</p>
                        </td>
                      </tr>
                    ) : projectAssignees.length ? (
                      projectAssignees.map(({ user, stats }) => (
                        <tr key={user._id} className="border-b border-[#d8e0d5] hover:bg-primary-50/60 transition">
                          <td className="px-2 py-3.5 w-[25%]">
                            <Link
                              to={`/admin/users/${user._id}`}
                              className="text-primary-800 hover:text-primary-900 font-medium text-sm"
                            >
                              {user.name || "Unknown user"}
                            </Link>
                          </td>
                          <td className="px-2 py-3.5 w-[18%]">
                            <span className="font-mono text-[11px] text-black/70">{user.username || "-"}</span>
                          </td>
                          <td className="px-2 py-3.5 w-[25%]">
                            <span className="text-xs text-black/70 truncate block" title={user.email}>{user.email || "-"}</span>
                          </td>
                          <td className="px-2 py-3.5 w-[10%]">
                            <span className={`text-[11px] font-semibold ${user.isVerified ? "text-emerald-700" : "text-amber-700"}`}>
                              {user.isVerified ? "Verified" : "Pending"}
                            </span>
                          </td>
                          <td className="px-2 py-3.5 w-[22%]">
                            <div className="text-xs text-black/75">
                              {stats.done}/{stats.totalTasks} completed
                            </div>
                            <div className="text-[11px] text-black/55">
                              {stats.inProgress} in progress · {stats.discarded} discarded · {stats.pending} pending
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-black/60">
                          <User2 size={32} className="mx-auto mb-2 opacity-30" />
                          No annotators assigned yet. Verify a user to auto-assign their dedicated project, or use the user admin page to add assignments.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                null
              )}
            </div>
          </div>
        </>
      )}

      {confirmBulkDelete && (
        <Modal
          title={selectAllMatching ? "Delete every task in this project" : "Delete selected tasks"}
          onClose={() => !bulkDeleting && setConfirmBulkDelete(false)}
          size="md"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div className="text-sm text-black/80">
                <p className="font-medium mb-1">
                  {selectAllMatching
                    ? `Delete all ${selectedCount} task${selectedCount === 1 ? "" : "s"} in this project?`
                    : `Delete ${selectedCount} task${selectedCount === 1 ? "" : "s"}?`}
                </p>
                <p>
                  This also removes every annotator's submission and recorded audio
                  for those tasks. This can't be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmBulkDelete(false)}
                disabled={bulkDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={runBulkDelete}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? "Deleting…" : `Delete ${selectedCount}`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "form" && (
        <Modal title={editing ? "Edit Task" : "Create Task"} onClose={() => setModal(null)} size="lg">
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="label">Dialogue ID *</label>
              <input value={form.dialogueId} onChange={(e) => setForm((f) => ({ ...f, dialogueId: e.target.value }))}
                className="input" placeholder="e.g. cat03_000000" required />
            </div>
            <div>
              <label className="label">Chinese Transcript *</label>
              <textarea value={form.chineseTranscript} onChange={(e) => setForm((f) => ({ ...f, chineseTranscript: e.target.value }))}
                className="input resize-none" rows={6} placeholder="Enter the Chinese transcript…" required />
            </div>
            <div>
              <label className="label">Pinyin * <span className="normal-case text-slate-500">(correctable by the assigned user)</span></label>
              <textarea value={form.pinyin} onChange={(e) => setForm((f) => ({ ...f, pinyin: e.target.value }))}
                className="input resize-none" rows={6} placeholder="Enter the pinyin transliteration…" required />
            </div>
           {/* <div>
              <label className="label">Assign To <span className="normal-case text-slate-500">(optional)</span></label>
              <select value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))} className="input">
                <option value="">- Unassigned -</option>
                {users.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.email})</option>)}
              </select>
            </div>*/}
            <div className="flex gap-3 justify-end pt-2">
              <button type="submit" disabled={saving} className="btn-secondary">
                {saving ? "Saving…" : editing ? "Update Task" : "Create Task"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "submission" && (
        <Modal title={selectedTask?.taskId ? `Task Submission · ${selectedTask.taskId}` : "Task Submission"} onClose={closeSubmissionModal} size="xl">
          {submissionLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : selectedTask ? (
            <div className="max-h-[75vh] overflow-y-auto overflow-x-hidden scrollbar-hidden space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-[#c7d1c3] bg-[#eef2ec] p-4">
                  <p className="label mb-3">Project Details</p>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-black/55 text-xs uppercase tracking-wide">Project Name</p>
                      <p className="text-black mt-1">{project?.name || "Not available"}</p>
                    </div>
                    <div>
                      <p className="text-black/55 text-xs uppercase tracking-wide">Description</p>
                      <p className="text-black/80 mt-1 whitespace-pre-wrap">{project?.description || "No description"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#c7d1c3] bg-[#eef2ec] p-4">
                  <p className="label mb-3">Task Details</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-black/55 text-xs uppercase tracking-wide">Task ID</p>
                      <p className="text-black mt-1 font-mono">{selectedTask.taskId}</p>
                    </div>
                    <div>
                      <p className="text-black/55 text-xs uppercase tracking-wide">Dialogue ID</p>
                      <p className="text-black/80 mt-1">{selectedTask.dialogueId}</p>
                    </div>
                    <div>
                      <p className="text-black/55 text-xs uppercase tracking-wide">Status</p>
                      <p className="text-black/80 mt-1 capitalize">{selectedSubmission?.status || "pending"}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-[#c7d1c3] bg-[#eef2ec] p-4 min-w-0">
                  <div className="flex items-center gap-2 mb-3 text-black/80">
                    <FileText size={16} className="text-primary-400" />
                    <p className="label m-0">Chinese Script</p>
                  </div>
                  <p className="text-black whitespace-pre-wrap break-all text-sm leading-relaxed">
                    {selectedSubmission?.correctedChineseTranscript || selectedTask.chineseTranscript || "No transcript provided."}
                  </p>
                </div>

                <div className="rounded-2xl border border-[#c7d1c3] bg-[#e6eee2] p-4 min-w-0">
                  <div className="flex items-center gap-2 mb-3 text-black/80">
                    <FileText size={16} className="text-primary-400" />
                    <p className="label m-0">Pinyin</p>
                  </div>
                  <p className="text-black whitespace-pre-wrap break-all text-sm leading-relaxed">
                    {selectedSubmission?.correctedPinyin || selectedTask.pinyin || "No pinyin provided."}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-2xl border border-[#c7d1c3] bg-[#eef2ec] p-4">
                  <div className="flex items-center gap-2 mb-3 text-black/80">
                    <FileAudio size={16} className="text-emerald-400" />
                    <p className="label m-0">Audio Submission</p>
                  </div>

                  {submissionAudioUrl ? (
                    <div className="space-y-4">
                      <audio controls src={submissionAudioUrl} className="w-full" />
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-black/55 text-xs uppercase tracking-wide">Uploaded At</p>
                          <p className="text-black/80 mt-1">{formatDateTime(selectedSubmission?.audio?.uploadedAt)}</p>
                        </div>
                        <div>
                          <p className="text-black/55 text-xs uppercase tracking-wide">File Size</p>
                          <p className="text-black/80 mt-1">{formatFileSize(selectedSubmission?.audio?.fileSizeBytes)}</p>
                        </div>
                        <div>
                          <p className="text-black/55 text-xs uppercase tracking-wide">Format</p>
                          <p className="text-black/80 mt-1">{selectedSubmission?.audio?.contentType || "audio/wav"}</p>
                        </div>
                        <div>
                          <p className="text-black/55 text-xs uppercase tracking-wide">Audio Spec</p>
                          <p className="text-black/80 mt-1">
                            {selectedSubmission?.audio?.sampleRate || 16000} Hz · {selectedSubmission?.audio?.bitDepth || 16}-bit · {selectedSubmission?.audio?.channels || 1} ch
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[#c5cec1] bg-white px-4 py-8 text-center">
                      <Mic2 size={24} className="mx-auto mb-2 text-black/55" />
                      <p className="text-black/60 text-sm">No audio submission available for this selection yet.</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-[#c7d1c3] bg-[#eef2ec] p-4">
                  <div className="flex items-center gap-2 text-black/80 mb-2">
                    <User2 size={15} className="text-sky-400" />
                    <p className="label m-0">Submission User</p>
                  </div>
                  <p className="text-black text-sm">{selectedSubmission?.userId?.name || "No submission selected"}</p>
                  <p className="text-black/55 text-xs mt-1">{selectedSubmission?.userId?.email || "No user email available"}</p>
                </div>

                <div className="rounded-2xl border border-[#c7d1c3] bg-[#eef2ec] p-4">
                  <div className="flex items-center gap-2 text-black/80 mb-2">
                    <CalendarClock size={15} className="text-primary-400" />
                    <p className="label m-0">Created</p>
                  </div>
                  <p className="text-black text-sm">{formatDateTime(selectedTask.createdAt)}</p>
                </div>

                <div className="rounded-2xl border border-[#c7d1c3] bg-[#eef2ec] p-4">
                  <div className="flex items-center gap-2 text-black/80 mb-2">
                    <CalendarClock size={15} className="text-emerald-400" />
                    <p className="label m-0">Last Updated</p>
                  </div>
                  <p className="text-black text-sm">{formatDateTime(selectedTask.updatedAt)}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-black/55 text-sm">Task submission details are not available.</div>
          )}
        </Modal>
      )}
    </AdminLayout>
  );
}
