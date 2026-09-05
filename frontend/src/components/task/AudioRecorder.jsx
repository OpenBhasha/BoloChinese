import { useEffect, useRef, useState } from "react";
import { Mic, Play, Pause, RotateCcw, Send } from "lucide-react";
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
 * Records mic audio (mono 16 kHz 16-bit PCM WAV - enforced client- and
 * server-side), previews it locally via Retry / Submit & Next, and plays back
 * any audio already stored for the task. Prev/Next navigation lives outside
 * this component (see the TaskNavBar in TaskDetail).
 *
 * Only mounted once the annotator has passed the verification step.
 */
export default function AudioRecorder({
  task,
  taskId,
  nextTask,
  onNavigate,
  onAfterUpload,
  onSubmittingChange,
  onPendingRecordingChange,
  readOnly = false,
}) {
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

  // Tell the parent when a fresh recording is waiting to be sent - lets the
  // task-nav bar hide its plain Next so it doesn't look like a way to skip
  // past the unsent audio.
  useEffect(() => {
    onPendingRecordingChange?.(Boolean(audioBlob));
  }, [audioBlob, onPendingRecordingChange]);

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

  const hasStoredAudio = Boolean(task?.audio?.publicId || task?.audio?.url);

  // Compact action strip - all buttons on a single row, no vertical labels.
  // Sits inside a fixed panel (see TaskDetail), so vertical space is precious.
  const renderActions = () => {
    if (audioBlob) {
      return (
        <>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-1.5 rounded-full bg-white text-primary-700 px-3 h-10 text-sm font-semibold shadow"
            aria-label="Retry recording"
          >
            <RotateCcw size={16} /> Retry
          </button>
          <button
            type="button"
            onClick={handleSubmitAndNext}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 text-white px-4 h-10 text-sm font-semibold shadow disabled:opacity-60"
            aria-label={nextTask ? "Submit recording and go to next task" : "Submit recording"}
          >
            <Send size={16} /> {nextTask ? "Submit & Next" : "Submit"}
          </button>
        </>
      );
    }

    return (
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        className={`w-12 h-12 rounded-full flex items-center justify-center shadow transition ${recording ? "bg-red-500 animate-pulse" : "bg-white"}`}
        aria-label={recording ? "Stop recording" : "Start recording"}
      >
        {recording ? renderRecordingWave() : <Mic size={22} className="text-primary-700" />}
      </button>
    );
  };

  return (
    <div className="rounded-xl bg-primary-700 px-3 py-2 flex flex-col gap-2">
      {/* Row 1: playback strip (only when audio is available - fresh or stored). */}
      {(hasStoredAudio || audioBlob) && (
        <>
          <audio
            ref={audioRef}
            src={audioUrl || undefined}
            onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
            onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
            onEnded={() => setPlaying(false)}
            className="hidden"
          />
          <div className="flex items-center gap-2 w-full">
            <button
              type="button"
              onClick={togglePlayback}
              className="recorder-btn-label shrink-0"
              aria-label={playing ? "Pause audio" : "Play audio"}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}
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
              className="flex-1 accent-white"
            />
            <span className="recorder-btn-label text-[11px] min-w-[64px] text-right shrink-0">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </>
      )}

      {/* Row 2: recording timer + action buttons (mic / Retry + Submit & Next). */}
      <div className="flex items-center justify-center gap-4">
        {recording && (
          <span className="shrink-0 rounded-md bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5">
            {formatTime(recordingElapsed)}
          </span>
        )}
        {!readOnly && renderActions()}
      </div>
    </div>
  );
}
