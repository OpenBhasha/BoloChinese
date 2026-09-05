import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import UserLayout from "../../components/layout/UserLayout";
import { getTaskDetail, getProjectTasks, recordTaskTime } from "../../api/user.api";
import AudioRecorder from "../../components/task/AudioRecorder";
import TranscriptVerification from "../../components/task/TranscriptVerification";
import StatusBadge from "../../utils/statusBadge";
import { CheckCircle2, SkipBack, SkipForward, Lock, PartyPopper } from "lucide-react";
import { PageSpinner } from "../../components/ui/Spinner";
import toast from "react-hot-toast";

// Fixed bottom bar - Prev is always available, Next is only enabled after the
// current task is finished (audio uploaded or discarded). This locks the flow
// to sequential completion: annotators can revisit earlier work, but can't
// jump past an in-progress task.
function TaskNavBar({ prevTask, nextTask, onNavigate, disableNext }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-primary-700 border-t border-primary-800 z-30">
      <div className="max-w-5xl mx-auto h-16 px-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => (prevTask ? onNavigate(prevTask._id) : toast("This is the first task"))}
          disabled={!prevTask}
          className="inline-flex items-center gap-2 recorder-btn-label text-sm font-semibold disabled:opacity-40"
        >
          <SkipBack size={22} /> Previous
        </button>
        <button
          type="button"
          onClick={() => {
            if (disableNext) {
              toast("Finish this task before moving on.");
              return;
            }
            if (!nextTask) {
              toast("You are on the last task");
              return;
            }
            onNavigate(nextTask._id);
          }}
          disabled={!nextTask || disableNext}
          title={disableNext ? "Finish this task first" : undefined}
          className="inline-flex items-center gap-2 recorder-btn-label text-sm font-semibold disabled:opacity-40"
        >
          {disableNext && <Lock size={14} />} Next <SkipForward size={22} />
        </button>
      </div>
    </div>
  );
}

// Full-page success card shown when every task in the project is terminal.
// No redirect - the annotator can just close the tab. "That's it."
function ProjectFinished() {
  return (
    <div className="card flex flex-col items-center text-center py-16 max-w-lg mx-auto mt-16">
      <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
        <PartyPopper size={28} className="text-emerald-700" />
      </div>
      <h1 className="text-2xl font-bold text-primary-900 mb-2">Project finished</h1>
      <p className="text-sm text-black/70">
        That's it. You've completed every task in this project. You can close this tab now.
      </p>
    </div>
  );
}

// A "finished" task lets the annotator move on: audio uploaded (completed) or
// discarded. Verified/corrected but no audio yet = not finished.
const isTaskFinished = (task) =>
  Boolean(
    task &&
      (task.status === "completed" ||
        task.status === "discarded" ||
        task.discarded?.flagged ||
        task.audio?.publicId ||
        task.audio?.url)
  );

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [switchingTask, setSwitchingTask] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [projectTasks, setProjectTasks] = useState([]);
  // eslint-disable-next-line no-unused-vars
  const [recorderSubmitting, setRecorderSubmitting] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [pendingRecording, setPendingRecording] = useState(false);

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

  // ─── Time tracking ──────────────────────────────────────────────────────────
  // Accumulate wall-clock milliseconds the annotator spends on this task.
  // Pause when the tab is hidden, flush on unmount / navigation / page hide.
  const taskStartRef = useRef(null);
  const accumulatedRef = useRef(0);
  const currentTaskIdRef = useRef(id);

  useEffect(() => {
    currentTaskIdRef.current = id;
    accumulatedRef.current = 0;
    taskStartRef.current = document.visibilityState === "visible" ? Date.now() : null;

    const pause = () => {
      if (taskStartRef.current) {
        accumulatedRef.current += Date.now() - taskStartRef.current;
        taskStartRef.current = null;
      }
    };
    const resume = () => {
      if (!taskStartRef.current) taskStartRef.current = Date.now();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") pause();
      else resume();
    };
    const flush = () => {
      pause();
      const ms = accumulatedRef.current;
      accumulatedRef.current = 0;
      if (ms > 500 && currentTaskIdRef.current) {
        // Best effort - on SPA navigation the axios request goes through
        // normally; on hard-unload it may be cancelled, and we lose the
        // last partial delta. Not worth a keepalive dance for a heuristic.
        recordTaskTime(currentTaskIdRef.current, ms).catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
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

  // "Project finished" = every task in this project is in a terminal state.
  // When we detect it, show a success card and auto-redirect to the annotator
  // profile after a moment. Handles the "just submitted the last task" case.
  const projectFinished = projectTasks.length > 0 && completedCount === projectTasks.length;
  if (projectFinished) {
    return (
      <UserLayout>
        <ProjectFinished />
      </UserLayout>
    );
  }

  // Bottom padding keeps the last card clear of the fixed nav bar (64px) and,
  // when the recorder is mounted, the compact recorder panel above it.
  const scrollBottomPad = canRecord ? "pb-56" : "pb-20";
  const finished = isTaskFinished(task);
  const nextDisabled = !finished;
  // Once submitted (audio uploaded) or discarded, the task is read-only.
  // Nothing can be re-edited, re-recorded, or reopened - annotators can only
  // page through with Prev / Next.
  const readOnly = finished;

  return (
    <UserLayout>
      <div className={scrollBottomPad}>
      {switchingTask && (
        <div className="mb-4 text-xs text-primary-500">Loading next task...</div>
      )}

      {/* Header - status badge + dialogue id only. The "Task N of M" pill was
          removed per product ask; the progress bar below still shows N/M. */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="mb-1">
            <StatusBadge status={task.status} />
          </div>
          <h1 className="text-xl font-bold text-primary-900">{task.dialogueId}</h1>
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
          // Keep the projectTasks list in sync with the current task's
          // status so the "N/M Completed" progress bar updates immediately
          // after Discard (which otherwise waits until the annotator
          // navigates far enough to trigger a refetch).
          onProjectTaskPatch={(taskId, patch) =>
            setProjectTasks((prev) =>
              prev.map((t) => (t._id === taskId ? { ...t, ...patch } : t))
            )
          }
          readOnly={readOnly}
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
      </div>
      </div>

      {/* Recorder pinned above the nav bar - only mounted after verification. */}
      {canRecord && (
        <div className="fixed bottom-16 left-0 right-0 z-20 bg-surface border-t border-primary-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="max-w-5xl mx-auto px-3 py-2">
            <AudioRecorder
              task={task}
              taskId={id}
              nextTask={nextTask}
              readOnly={readOnly}
              onNavigate={(taskId) => navigate(`/user/tasks/${taskId}`)}
              onSubmittingChange={setRecorderSubmitting}
              onPendingRecordingChange={setPendingRecording}
              onAfterUpload={async ({ background } = {}) => {
                await refreshProjectTasks(task.projectId);
                // A background upload means the user has already navigated to the next
                // task by the time this resolves - refetching here would clobber it.
                if (!background) await fetchTask(id);
              }}
            />
          </div>
        </div>
      )}

      <TaskNavBar
        prevTask={prevTask}
        nextTask={nextTask}
        onNavigate={(taskId) => navigate(`/user/tasks/${taskId}`)}
        disableNext={nextDisabled}
      />
    </UserLayout>
  );
}
