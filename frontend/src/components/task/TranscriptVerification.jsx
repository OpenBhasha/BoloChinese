import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, RotateCcw, XCircle, Trash2 } from "lucide-react";
import Modal from "../ui/Modal";
import {
  verifyPinyin,
  correctTranscript,
  markErroneous,
  discardTask,
  reconsiderTask,
} from "../../api/user.api";
import { measureEdit, HEAVY_EDIT_RATIO } from "../../utils/textDiff";

// Derives which step to show from the submission state already persisted on the task,
// so reloading or switching tasks resumes exactly where the user left off.
const deriveStep = (task) => {
  if (task.discarded?.flagged) return "discarded";
  if (task.erroneous?.flagged) return "erroneous";
  if (task.pinyinVerified === true || task.isCorrected) return "ready-to-record";
  if (task.pinyinVerified === false) return "editing";
  return "gate";
};

// Shared two-panel layout (Chinese + Pinyin side by side) so the verify, edit,
// and post-edit review views all look identical.
function ScriptPanels({ chinese, pinyin, editable, onChineseChange, onPinyinChange, disabled }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="card bg-slate-50 border border-slate-200 min-w-0">
        <p className="label text-primary-400 mb-3">Original Chinese Text</p>
        {editable ? (
          <textarea
            className="input resize-none"
            rows={6}
            value={chinese}
            onChange={(e) => onChineseChange(e.target.value)}
            maxLength={20000}
            disabled={disabled}
          />
        ) : (
          <p className="text-primary-900 text-lg font-medium leading-relaxed whitespace-pre-wrap break-all">{chinese}</p>
        )}
      </div>
      <div className="card bg-slate-50 border border-slate-200 min-w-0">
        <div className="flex items-center gap-2 mb-3">
          {!editable && <CheckCircle2 size={14} className="text-emerald-500" />}
          <p className="label text-primary-400 mb-0">Pinyin Text</p>
        </div>
        {editable ? (
          <textarea
            className="input resize-none"
            rows={6}
            value={pinyin}
            onChange={(e) => onPinyinChange(e.target.value)}
            maxLength={20000}
            disabled={disabled}
          />
        ) : (
          <p className="text-primary-900 text-lg font-medium leading-relaxed whitespace-pre-wrap break-all">{pinyin}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Verify → Edit → Record workflow:
 *   gate            - "Verify Text" with Yes / No
 *   editing         - edit Chinese + Pinyin, then Submit or Discard
 *   ready-to-record - read-only review; the recorder unlocks
 *   erroneous       - terminal, undoable
 *   discarded       - terminal, undoable
 */
export default function TranscriptVerification({ task, onTaskUpdate }) {
  const [step, setStep] = useState(() => deriveStep(task));
  const [verifying, setVerifying] = useState(false);
  const [chineseDraft, setChineseDraft] = useState(task.correctedChineseTranscript || task.chineseTranscript);
  const [pinyinDraft, setPinyinDraft] = useState(task.correctedPinyin || task.pinyin);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [isErroneousModalOpen, setIsErroneousModalOpen] = useState(false);
  const [erroneousReason, setErroneousReason] = useState("");
  const [markingErroneous, setMarkingErroneous] = useState(false);
  const [reconsidering, setReconsidering] = useState(false);

  const displayChinese = task.correctedChineseTranscript || task.chineseTranscript;
  const displayPinyin = task.correctedPinyin || task.pinyin;

  // Edit tracking - each Chinese character counts as one word.
  const chineseEdit = useMemo(
    () => measureEdit(task.chineseTranscript, chineseDraft),
    [task.chineseTranscript, chineseDraft]
  );
  const pinyinEdit = useMemo(
    () => measureEdit(task.pinyin, pinyinDraft),
    [task.pinyin, pinyinDraft]
  );
  const heavyEdit = chineseEdit.ratio > HEAVY_EDIT_RATIO;

  const handleVerify = async (correct) => {
    setVerifying(true);
    try {
      await verifyPinyin(task._id, correct);
      if (correct) {
        onTaskUpdate({ pinyinVerified: true, status: "verified" });
        setStep("ready-to-record");
      } else {
        onTaskUpdate({ pinyinVerified: false, status: "in-progress" });
        setStep("editing");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to record verification.");
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmitCorrection = async () => {
    if (!chineseDraft.trim() || !pinyinDraft.trim()) {
      toast.error("Chinese and Pinyin text can't be empty.");
      return;
    }
    setSavingCorrection(true);
    try {
      await correctTranscript(task._id, chineseDraft, pinyinDraft);
      onTaskUpdate({
        correctedChineseTranscript: chineseDraft,
        correctedPinyin: pinyinDraft,
        isCorrected: true,
        editCharCount: chineseEdit.distance,
        status: "corrected",
      });
      toast.success("Correction submitted.");
      setStep("ready-to-record");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to submit correction.");
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleDiscard = async () => {
    setDiscarding(true);
    try {
      await discardTask(task._id);
      onTaskUpdate({ discarded: { flagged: true, discardedAt: new Date().toISOString() }, status: "discarded" });
      toast.success("Task discarded.");
      setStep("discarded");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to discard task.");
    } finally {
      setDiscarding(false);
    }
  };

  const openErroneousModal = () => {
    setErroneousReason("");
    setIsErroneousModalOpen(true);
  };

  const submitErroneous = async (event) => {
    event.preventDefault();
    const reason = erroneousReason.trim();
    if (!reason) {
      toast.error("Please describe why this item is erroneous.");
      return;
    }

    setMarkingErroneous(true);
    try {
      await markErroneous(task._id, reason);
      onTaskUpdate({ erroneous: { flagged: true, reason, markedAt: new Date().toISOString() }, status: "erroneous" });
      toast.success("Marked erroneous.");
      setIsErroneousModalOpen(false);
      setStep("erroneous");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to mark item erroneous.");
    } finally {
      setMarkingErroneous(false);
    }
  };

  const handleReconsider = async () => {
    const hasAudio = Boolean(task.audio?.publicId || task.audio?.url);
    if (hasAudio) {
      const proceed = window.confirm(
        "You've already recorded audio for this task. Re-opening verification will require you to record the audio again. Continue?"
      );
      if (!proceed) return;
    }

    setReconsidering(true);
    try {
      await reconsiderTask(task._id);
      onTaskUpdate({
        erroneous: { flagged: false, reason: "", markedAt: null },
        discarded: { flagged: false, discardedAt: null },
        pinyinVerified: null,
        isCorrected: false,
        status: "in-progress",
        // Force the recorder back into empty state so the annotator must
        // re-record after re-verifying. The server-side audio (if any) is
        // overwritten on the next upload.
        ...(hasAudio ? { audio: null } : {}),
      });
      if (hasAudio) {
        toast("Please record fresh audio after verifying.");
      }
      setChineseDraft(task.chineseTranscript);
      setPinyinDraft(task.pinyin);
      setStep("gate");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reopen this item.");
    } finally {
      setReconsidering(false);
    }
  };

  if (step === "discarded") {
    return (
      <div className="card border-red-300 bg-red-50">
        <div className="flex items-start gap-3">
          <Trash2 size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="label text-red-600 mb-1">Task Discarded</p>
            <p className="text-sm text-red-800">
              You discarded this item from the edit screen. It won't be recorded unless you reopen it.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleReconsider}
          disabled={reconsidering}
          className="btn-secondary text-sm mt-4 inline-flex items-center gap-1.5"
        >
          <RotateCcw size={14} /> {reconsidering ? "Reopening…" : "Undo / Re-verify"}
        </button>
      </div>
    );
  }

  if (step === "erroneous") {
    return (
      <div className="card border-red-300 bg-red-50">
        <div className="flex items-start gap-3">
          <XCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="label text-red-600 mb-1">Marked Erroneous</p>
            <p className="text-sm text-red-800 whitespace-pre-wrap break-all">{task.erroneous?.reason}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleReconsider}
          disabled={reconsidering}
          className="btn-secondary text-sm mt-4 inline-flex items-center gap-1.5"
        >
          <RotateCcw size={14} /> {reconsidering ? "Reopening…" : "Undo / Re-verify"}
        </button>
      </div>
    );
  }

  if (step === "ready-to-record") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 size={16} />
          <span>
            {task.isCorrected ? "Correction submitted - recording unlocked." : "Text verified - recording unlocked."}
          </span>
        </div>
        <ScriptPanels chinese={displayChinese} pinyin={displayPinyin} editable={false} />
        <button
          type="button"
          onClick={handleReconsider}
          disabled={reconsidering}
          className="btn-secondary text-xs inline-flex items-center gap-1.5"
        >
          <RotateCcw size={13} /> {reconsidering ? "Reopening…" : "Re-open verification"}
        </button>
      </div>
    );
  }

  if (step === "editing") {
    return (
      <>
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-semibold mb-0.5">Minor corrections only</p>
            <p>
              Fix deleted / missing words and background-noise or transcription artifacts. Don't rewrite the
              sentence. Each Chinese character counts as one word.
            </p>
          </div>

          <ScriptPanels
            chinese={chineseDraft}
            pinyin={pinyinDraft}
            editable
            disabled={savingCorrection || discarding}
            onChineseChange={setChineseDraft}
            onPinyinChange={setPinyinDraft}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-black/60">
            <span>Chinese edits: <b>{chineseEdit.distance}</b> / {chineseEdit.base} chars</span>
            <span>Pinyin edits: <b>{pinyinEdit.distance}</b></span>
            {heavyEdit && (
              <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                <AlertTriangle size={13} /> Large change - keep edits minor or mark the item erroneous.
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSubmitCorrection}
              disabled={savingCorrection || discarding}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingCorrection ? "Submitting…" : "Submit"}
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={savingCorrection || discarding}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Trash2 size={14} /> {discarding ? "Discarding…" : "Discard"}
            </button>
            <button
              type="button"
              onClick={openErroneousModal}
              disabled={savingCorrection || discarding}
              className="btn-secondary text-red-700 inline-flex items-center gap-1.5"
            >
              <AlertTriangle size={14} /> Mark Erroneous / Invalid
            </button>
          </div>
        </div>

        {isErroneousModalOpen && (
          <Modal title="Mark Erroneous / Invalid" onClose={() => !markingErroneous && setIsErroneousModalOpen(false)} size="md">
            <form onSubmit={submitErroneous} className="space-y-4">
              <div>
                <p className="text-sm text-black/70 mb-2">
                  This marks the item as invalid - it will be excluded from the valid dataset and skipped for recording.
                </p>
                <textarea
                  className="input resize-none"
                  rows={4}
                  placeholder="Describe why this item can't be reliably corrected"
                  value={erroneousReason}
                  onChange={(e) => setErroneousReason(e.target.value)}
                  maxLength={1000}
                  required
                  disabled={markingErroneous}
                />
                <p className="text-xs text-black/55 mt-1">{erroneousReason.length}/1000</p>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary" onClick={() => setIsErroneousModalOpen(false)} disabled={markingErroneous}>
                  Cancel
                </button>
                <button type="submit" className="btn-danger" disabled={markingErroneous}>
                  {markingErroneous ? "Submitting…" : "Mark Erroneous"}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </>
    );
  }

  // step === "gate"
  return (
    <div className="space-y-4">
      <div>
        <p className="label text-primary-400 mb-1">Step 1 - Verify Text</p>
        <p className="text-sm text-black/70">
          Does the Chinese text and its Pinyin accurately represent the source? Choose <b>Yes</b> to start recording,
          or <b>No</b> to make minor corrections.
        </p>
      </div>

      <ScriptPanels chinese={task.chineseTranscript} pinyin={task.pinyin} editable={false} />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleVerify(true)}
          disabled={verifying}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => handleVerify(false)}
          disabled={verifying}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          No
        </button>
      </div>
    </div>
  );
}
