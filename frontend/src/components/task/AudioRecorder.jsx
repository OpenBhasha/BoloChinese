import { useEffect, useRef, useState } from "react";
import { Mic, Play, Pause, SkipBack, SkipForward, RotateCcw, Send } from "lucide-react";
import { streamAudio, uploadAudio } from "../../api/user.api";
import { createPcmRecorder } from "../../utils/wavRecorder";
import toast from "react-hot-toast";

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

const MIC_CONSTRAINTS = {
  audio: {
    channelCount: 1,
    sampleRate: 16000,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

/**
 * Shared audio recorder used by every task type: record/stop, play back the
 * recording (or the previously submitted audio), and step to the prev/next
 * task in the project.
 *
 * Capture is forced to mono 16 kHz 16-bit PCM WAV (see utils/wavRecorder.js) -
 * the backend rejects anything else.
 *
 * Only mounted once the annotator has passed the verification step - see
 * `canRecord` in TaskDetail.
 */
export default function AudioRecorder({ task, taskId, prevTask, nextTask, onNavigate, onAfterUpload, onSubmittingChange }) {
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const recordingTickerRef = useRef(null);

  useEffect(() => {
    onSubmittingChange?.(submitting);
  }, [submitting, onSubmittingChange]);

  // Load the recorded/submitted audio whenever the task changes, and clear local state.
  useEffect(() => {
    let cancelled = false;
    const hasAudio = Boolean(task?.audio?.publicId || task?.audio?.url);

    (async () => {
      if (hasAudio) {
        try {
          const response = await streamAudio(taskId);
          if (cancelled) return;
          const url = URL.createObjectURL(response.data);
          setAudioUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        } catch {
          if (!cancelled) {
            setAudioUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }
        }
      } else {
        setAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }
      if (!cancelled) {
        setAudioBlob(null);
        setPlaying(false);
        setCurrentTime(0);
      }
    })();

    return () => { cancelled = true; };
  }, [taskId, task?.audio?.publicId, task?.audio?.url]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (recording) {
      if (!recordingStartedAtRef.current) {
        recordingStartedAtRef.current = Date.now();
      }
      recordingTickerRef.current = window.setInterval(() => {
        setRecordingElapsed(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
      }, 250);
    } else if (recordingTickerRef.current) {
      window.clearInterval(recordingTickerRef.current);
      recordingTickerRef.current = null;
    }

    return () => {
      if (recordingTickerRef.current) {
        window.clearInterval(recordingTickerRef.current);
        recordingTickerRef.current = null;
      }
    };
  }, [recording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      streamRef.current = stream;
      recorderRef.current = createPcmRecorder(stream);
      setRecordingElapsed(0);
      recordingStartedAtRef.current = Date.now();
      setRecording(true);
    } catch {
      toast.error("Microphone access denied. Please allow mic access.");
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);

    try {
      const blob = recorder ? await recorder.stop() : null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      if (blob && blob.size > 44) {
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setPlaying(false);
        setCurrentTime(0);
      } else {
        toast.error("Recording was empty. Please try again.");
      }
    } catch {
      toast.error("Could not finalise the recording. Please try again.");
    }
  };

  const renderRecordingWave = () => (
    <div className="recording-wave" aria-hidden="true">
      <span className="recording-wave__bar" />
      <span className="recording-wave__bar" />
      <span className="recording-wave__bar" />
      <span className="recording-wave__bar" />
      <span className="recording-wave__bar" />
    </div>
  );

  const uploadRecordedAudio = async ({ background = false } = {}) => {
    if (recording) {
      toast.error("Stop recording before submitting.");
      return false;
    }
    if (!audioBlob) {
      toast.error("Please record audio first.");
      return false;
    }

    const blob = audioBlob;
    const displayTaskId = task.taskId;
    const file = new File([blob], `${displayTaskId}.wav`, { type: "audio/wav" });
    const performUpload = async () => {
      await uploadAudio(taskId, file);
      await onAfterUpload?.({ background });
    };

    if (background) {
      setAudioBlob(null);
      audioRef.current?.pause();
      setPlaying(false);
      setCurrentTime(0);
      setAudioUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });

      performUpload()
        .then(() => toast.success(`Audio submitted for ${displayTaskId}.`))
        .catch((err) => toast.error(err.response?.data?.message || `Submission failed for ${displayTaskId}`));

      return true;
    }

    setSubmitting(true);
    try {
      await performUpload();
      toast.success("Audio submitted successfully!");
      return true;
    } catch (err) {
      toast.error(err.response?.data?.message || "Submission failed");
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitAndNext = async () => {
    if (!audioBlob) {
      toast.error("Please record audio first.");
      return;
    }
    if (nextTask) {
      const started = await uploadRecordedAudio({ background: true });
      if (!started) return;
      toast("Uploading audio in background. Moving to next task...");
      onNavigate(nextTask._id);
    } else {
      // Last task - foreground upload and stay put so the annotator sees the result.
      await uploadRecordedAudio({ background: false });
    }
  };

  const handleRetry = () => {
    // Drop the fresh recording; the mic control returns so the annotator can record again.
    setAudioBlob(null);
    setAudioUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  const hasStoredAudio = Boolean(task?.audio?.publicId || task?.audio?.url);

  // Free navigation once the task is finished (audio uploaded, completed, or discarded).
  const isTaskFinished =
    task?.status === "completed" ||
    task?.status === "discarded" ||
    hasStoredAudio;

  const handleNext = async () => {
    if (!nextTask) {
      toast("You are on the last task");
      return;
    }
    if (recording) {
      toast.error("Stop recording before moving to next task.");
      return;
    }
    if (audioBlob) {
      // The dedicated "Submit & Next" button drives this; the plain Next
      // shouldn't skip past an unsent recording.
      toast("Use Submit & Next to send your recording.");
      return;
    }
    if (isTaskFinished) {
      onNavigate(nextTask._id);
      return;
    }
    toast.error("Please record audio before moving on.");
  };

  const handlePrev = () => {
    if (prevTask) onNavigate(prevTask._id);
    else toast("This is the first task");
  };

  const togglePlayback = async () => {
    if (!audioRef.current || !audioUrl) {
      toast.error("No recorded audio available.");
      return;
    }
    try {
      if (playing) audioRef.current.pause();
      else await audioRef.current.play();
      setPlaying((prev) => !prev);
    } catch {
      toast.error("Unable to play audio.");
    }
  };

  // Prev / Record-Stop / Next row - used by the desktop card and the fixed mobile bar.
  // When a fresh recording is waiting to be submitted, the middle button is replaced
  // by Retry + Submit-and-Next so the annotator can review before sending.
  const renderControlRow = (size, { showLabels = false } = {}) => {
    const btnLabel = (text) =>
      showLabels ? <span className="recorder-btn-label text-sm font-semibold mt-2">{text}</span> : null;

    return (
      <div className="flex items-end justify-center gap-6 md:gap-10">
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={handlePrev}
            className="w-12 h-12 rounded-full bg-white text-primary-700 flex items-center justify-center disabled:opacity-40"
            disabled={!prevTask}
            aria-label="Previous task"
          >
            <SkipBack size={size} />
          </button>
          {btnLabel("Previous")}
        </div>

        {audioBlob ? (
          <>
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={handleRetry}
                className="w-16 h-16 rounded-full bg-white text-primary-700 flex items-center justify-center shadow-lg"
                aria-label="Retry recording"
              >
                <RotateCcw size={22} />
              </button>
              {btnLabel("Retry")}
            </div>
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={handleSubmitAndNext}
                disabled={submitting}
                className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg disabled:opacity-60"
                aria-label={nextTask ? "Submit recording and go to next task" : "Submit recording"}
              >
                <Send size={22} />
              </button>
              {btnLabel(nextTask ? "Submit & Next" : "Submit")}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition ${recording ? "bg-red-500 animate-pulse" : "bg-white"}`}
              aria-label={recording ? "Stop recording" : "Start recording"}
            >
              {recording ? renderRecordingWave() : <Mic size={24} className="text-primary-700" />}
            </button>
            {btnLabel(recording ? "Stop" : "Record")}
          </div>
        )}

        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={handleNext}
            className="w-12 h-12 rounded-full bg-white text-primary-700 flex items-center justify-center disabled:opacity-40"
            disabled={!nextTask || submitting}
            aria-label="Next task"
          >
            <SkipForward size={size} />
          </button>
          {btnLabel("Next")}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="card">
        <p className="label mb-3">Recording Status</p>
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-sm text-slate-400">
            {recording
              ? "Recording in progress..."
              : audioBlob
              ? "New recording ready. Review, then Submit & Next or Retry."
              : "Use the mic below to record."}
          </p>
          {recording && (
            <span className="shrink-0 rounded-md bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1">
              {formatTime(recordingElapsed)}
            </span>
          )}
        </div>

        <div className="hidden md:block rounded-2xl bg-primary-700 px-5 py-4 mb-4">
          {renderControlRow(26, { showLabels: true })}
        </div>

        {/* Playback is only offered for audio already stored on the server
            (i.e. `task.audio` is set). A fresh recording is meant to be sent
            via Submit & Next or dropped via Retry, without a preview step. */}
        {hasStoredAudio && (
          <>
            <audio
              ref={audioRef}
              src={audioUrl || undefined}
              onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
              onEnded={() => setPlaying(false)}
              className="hidden"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlayback}
                className="text-primary-900"
                aria-label={playing ? "Pause audio" : "Play audio"}
              >
                {playing ? <Pause size={22} /> : <Play size={22} />}
              </button>
              <input
                type="range"
                min="0"
                max={duration || 0}
                step="0.01"
                value={currentTime}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (!audioRef.current) return;
                  audioRef.current.currentTime = value;
                  setCurrentTime(value);
                }}
                className="w-full accent-primary-700"
              />
              <span className="text-xs text-primary-500 min-w-[76px] text-right">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-primary-700 border-t border-primary-800 z-30 md:hidden">
        <div className="max-w-5xl mx-auto h-24 px-4 flex items-center justify-center">
          {renderControlRow(28, { showLabels: true })}
        </div>
      </div>
    </>
  );
}
