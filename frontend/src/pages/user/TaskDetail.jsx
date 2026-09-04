import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import UserLayout from "../../components/layout/UserLayout";
import { getTaskDetail, getProjectTasks } from "../../api/user.api";
import AudioRecorder from "../../components/task/AudioRecorder";
import TranscriptVerification from "../../components/task/TranscriptVerification";
import StatusBadge from "../../utils/statusBadge";
import { ChevronLeft, CheckCircle2 } from "lucide-react";
import { PageSpinner } from "../../components/ui/Spinner";
import toast from "react-hot-toast";

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [switchingTask, setSwitchingTask] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [projectTasks, setProjectTasks] = useState([]);
  const [recorderSubmitting, setRecorderSubmitting] = useState(false);

  const refreshProjectTasks = async (projectId) => {
    const tasksRes = await getProjectTasks(projectId);
    setProjectTasks(tasksRes.data.data.tasks || []);
  };

  const fetchTask = async (taskId, { smooth = false } = {}) => {
    if (!taskId) return;

    if (smooth) setSwitchingTask(true);
    else setLoading(true);

    try {
      const taskRes = await getTaskDetail(taskId);
      const taskData = taskRes.data.data;
      setTask(taskData);

      if (!activeProjectId || activeProjectId !== String(taskData.projectId) || projectTasks.length === 0) {
        const tasksRes = await getProjectTasks(taskData.projectId);
        setProjectTasks(tasksRes.data.data.tasks || []);
        setActiveProjectId(String(taskData.projectId));
      }
    } catch {
      toast.error("Failed to load task");
    } finally {
      if (smooth) setSwitchingTask(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    const isInitialLoad = !task;
    fetchTask(id, { smooth: !isInitialLoad });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // The recording screen is only available after the user confirms the text
  // (Yes) or submits a correction (Submit). Discarded items stay locked.
  const canRecord = Boolean(
    task &&
      (task.pinyinVerified === true || task.isCorrected) &&
      !task.discarded?.flagged
  );

  const currentTaskIndex = useMemo(
    () => projectTasks.findIndex((t) => t._id === id),
    [projectTasks, id]
  );
  const prevTask = currentTaskIndex > 0 ? projectTasks[currentTaskIndex - 1] : null;
  const nextTask = currentTaskIndex >= 0 ? projectTasks[currentTaskIndex + 1] : null;
  const completedCount = projectTasks.filter((t) => ["completed", "erroneous", "discarded"].includes(t.status)).length;
  const progressPercent = projectTasks.length ? Math.round((completedCount / projectTasks.length) * 100) : 0;

  if (loading) return <UserLayout><PageSpinner /></UserLayout>;
  if (!task) return <UserLayout><p className="text-slate-400">Task not found.</p></UserLayout>;

  return (
    <UserLayout>
      <div className="pb-32 md:pb-0">
      <Link
        to={task?.projectId ? `/user/projects/${task.projectId}` : "/user"}
        className="flex items-center gap-1.5 text-sm text-black/70 hover:text-black mb-6 transition"
      >
        <ChevronLeft size={16} /> Back to Tasks
      </Link>

      {switchingTask && (
        <div className="mb-4 text-xs text-primary-500">Loading next task...</div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm text-primary-400 bg-primary-500/10 px-2.5 py-0.5 rounded">
              {task.taskId}
            </span>
            <StatusBadge status={task.status} />
          </div>
          <h1 className="text-xl font-bold text-white">{task.dialogueId}</h1>
        </div>
      </div>

      <div className="space-y-4 min-w-0 overflow-x-hidden">
        <div className="card">
          <p className="text-sm text-black/70 font-medium mb-2">{completedCount}/{projectTasks.length || 0} Completed</p>
          <div className="w-full h-2 rounded-full bg-black/10 overflow-hidden">
            <div className="h-full bg-primary-700" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <TranscriptVerification
          key={task._id}
          task={task}
          nextTask={nextTask}
          onNavigate={(taskId) => navigate(`/user/tasks/${taskId}`)}
          onTaskUpdate={(patch) => setTask((t) => ({ ...t, ...patch }))}
        />

        {/* Audio status */}
        {(task.audio?.publicId || task.audio?.url) && (
          <div className="card border-emerald-500/30">
            <p className="label text-emerald-400 mb-2">Audio Recorded</p>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-emerald-300 font-medium">Audio uploaded successfully</p>
                <p className="mt-0.5">{(task.audio.fileSizeBytes / 1024).toFixed(1)} KB · {task.audio.sampleRate} Hz · {task.audio.bitDepth}-bit · Mono</p>
                <p className="mt-0.5 text-slate-500">{new Date(task.audio.uploadedAt).toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        {/* Recorder - only rendered once text verification is complete. */}
        {canRecord && (
          <AudioRecorder
            task={task}
            taskId={id}
            prevTask={prevTask}
            nextTask={nextTask}
            onNavigate={(taskId) => navigate(`/user/tasks/${taskId}`)}
            onSubmittingChange={setRecorderSubmitting}
            onAfterUpload={async ({ background } = {}) => {
              await refreshProjectTasks(task.projectId);
              // A background upload means the user has already navigated to the next
              // task by the time this resolves - refetching here would clobber it.
              if (!background) await fetchTask(id);
            }}
          />
        )}
      </div>
      </div>
    </UserLayout>
  );
}
