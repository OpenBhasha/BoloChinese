import { useEffect, useRef, useState } from "react";
import { Mic, Play, Pause, RotateCcw, Send } from "lucide-react";
import { streamAudio, uploadAudio } from "../../api/user.api";
import { createPcmRecorder } from "../../utils/wavRecorder";
import Modal from "../ui/Modal";
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
 * server-side) and plays back any audio already stored for the task.
 * Prev/Next navigation lives outside this component (see the TaskNavBar in
 * TaskDetail).
 *
 * The moment a recording finishes, a mandatory "Submit this recording?"
 * popup takes over: the annotator must listen to the take before Submit
 * unlocks, and the only other way out is to discard it and record again -
 * there's no dismissing the popup without deciding.
 *
 * Only mounted once the annotator has passed the verification step. `readOnly`
 * (set by the caller once a task is discarded) is the only thing that locks
 * recording out entirely - re-recording stays available even after a task's
 * audio has already been submitted.
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
  // Asked right after a recording finishes, before it's sent anywhere.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Gates the Submit button in that popup - must play the take through once.
  const [hasListened, setHasListened] = useState(false);

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
        setConfirmOpen(false);
        setHasListened(false);
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
    // Re-recording (over previously submitted audio) can start mid-playback -
    // stop that first so it isn't picked up by the new take.
    audioRef.current?.pause();
    setPlaying(false);
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
        setHasListened(false);
        // Ask right away, and hold the annotator there: Yes (after listening)
        // submits and moves on, No discards and lets them record again. The
        // popup can't be dismissed without picking one.
        setConfirmOpen(true);
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
    setConfirmOpen(false);
    setHasListened(false);
  };

  // "Are you sure you want to submit?" - shown as soon as a recording finishes.
  const handleConfirmSubmit = () => {
    if (!hasListened) return;
    setConfirmOpen(false);
    handleSubmitAndNext();
  };
  const handleConfirmRetry = () => {
    setConfirmOpen(false);
    handleRetry();
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

  // Play/pause + scrubber, shared by the dark recorder panel (Row 1, for
  // reviewing already-submitted audio) and the light confirm popup (for the
  // pending, not-yet-submitted take). Both drive the same <audio> element.
  const renderPlaybackStrip = (onDark) => (
    <div className="flex items-center gap-2 w-full">
      <button
        type="button"
        onClick={togglePlayback}
        className={`shrink-0 ${onDark ? "recorder-btn-label" : "text-primary-700"}`}
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
        className={`flex-1 ${onDark ? "accent-white" : "accent-primary-700"}`}
      />
      <span className={`text-[11px] min-w-[64px] text-right shrink-0 ${onDark ? "recorder-btn-label" : "text-black/70"}`}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );

  // Just the mic control - the pending-recording decision (submit / re-record)
  // now lives entirely in the mandatory confirm popup below. A foreground
  // submit on the last task closes that popup before the upload settles, so
  // show something here rather than going blank for that stretch.
  const renderActions = () => {
    if (submitting) {
      return <span className="recorder-btn-label text-xs font-medium px-3">Submitting…</span>;
    }
    if (audioBlob) return null;

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
    <>
      <div className="rounded-xl bg-primary-700 px-3 py-2 flex flex-col gap-2">
        {/* The <audio> element stays mounted for either audio source so
            audioRef is always valid; the confirm popup below owns the visible
            controls while a fresh take is pending. */}
        {(hasStoredAudio || audioBlob) && (
          <audio
            ref={audioRef}
            src={audioUrl || undefined}
            onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
            onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
            onEnded={() => { setPlaying(false); setHasListened(true); }}
            className="hidden"
          />
        )}

        {/* Row 1: playback strip for already-submitted audio (no pending take). */}
        {hasStoredAudio && !audioBlob && renderPlaybackStrip(true)}

        {/* Row 2: recording timer + mic control. */}
        <div className="flex items-center justify-center gap-4">
          {recording && (
            <span className="shrink-0 rounded-md bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5">
              {formatTime(recordingElapsed)}
            </span>
          )}
          {!readOnly && renderActions()}
        </div>
      </div>

      {confirmOpen && !readOnly && (
        <Modal title="Submit this recording?" size="sm" dismissible={false}>
          <div className="space-y-4">
            {renderPlaybackStrip(false)}
            <p className={`text-xs ${hasListened ? "text-emerald-600" : "text-black/60"}`}>
              {hasListened
                ? "Sounds good? Submit below, or record it again."
                : "Play the recording all the way through before you can submit."}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleConfirmRetry}
                className="btn-secondary inline-flex items-center gap-1.5"
              >
                <RotateCcw size={16} /> No, record again
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={!hasListened || submitting}
                title={hasListened ? undefined : "Listen to the recording first"}
                className="bg-emerald-500 hover:bg-emerald-600 !text-white px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                <Send size={16} /> Yes, submit{nextTask ? " & next" : ""}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
