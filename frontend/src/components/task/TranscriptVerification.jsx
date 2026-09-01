import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import Modal from "../ui/Modal";
import { verifyPinyin, correctTranscript, markErroneous, reconsiderTask } from "../../api/user.api";

// Derives which step to show from the submission state already persisted on the task,
// so reloading or switching tasks resumes exactly where the user left off.
const deriveStep = (task) => {
  if (task.erroneous?.flagged) return "erroneous";
  if (task.pinyinVerified === true || task.isCorrected) return "ready-to-record";
  if (task.pinyinVerified === false) return "correcting";
  return "gate";
};

/**
 * The Chinese transcript / Pinyin verification workflow:
 * gate (Pinyin Correct? Yes/No) -> correcting (edit both fields, or mark erroneous)
 * -> ready-to-record (hands off to AudioRecorder) -> erroneous (terminal, undoable).
 */
export default function TranscriptVerification({ task, onTaskUpdate }) {
  const [step, setStep] = useState(() => deriveStep(task));
  const [verifying, setVerifying] = useState(false);
  const [chineseDraft, setChineseDraft] = useState(task.correctedChineseTranscript || task.chineseTranscript);
  const [pinyinDraft, setPinyinDraft] = useState(task.correctedPinyin || task.pinyin);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [isErroneousModalOpen, setIsErroneousModalOpen] = useState(false);
  const [erroneousReason, setErroneousReason] = useState("");
  const [markingErroneous, setMarkingErroneous] = useState(false);
  const [reconsidering, setReconsidering] = useState(false);

  const displayChinese = task.correctedChineseTranscript || task.chineseTranscript;
  const displayPinyin = task.correctedPinyin || task.pinyin;

  const handleVerify = async (correct) => {
    setVerifying(true);
    try {
      await verifyPinyin(task._id, correct);
      if (correct) {
        onTaskUpdate({ pinyinVerified: true, status: "verified" });
        setStep("ready-to-record");
      } else {
        onTaskUpdate({ pinyinVerified: false, status: "in-progress" });
        setStep("correcting");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to record verification.");
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveCorrection = async () => {
    setSavingCorrection(true);
    try {
      await correctTranscript(task._id, chineseDraft, pinyinDraft);
      onTaskUpdate({
        correctedChineseTranscript: chineseDraft,
        correctedPinyin: pinyinDraft,
        isCorrected: true,
        status: "corrected",
      });
      toast.success("Correction saved.");
      setStep("ready-to-record");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to save correction.");
    } finally {
      setSavingCorrection(false);
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
    setReconsidering(true);
    try {
      await reconsiderTask(task._id);
      onTaskUpdate({ erroneous: { flagged: false, reason: "", markedAt: null }, pinyinVerified: null, status: "in-progress" });
      setStep("gate");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reopen this item.");
    } finally {
      setReconsidering(false);
    }
  };

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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card bg-slate-50 border border-slate-200">
          <p className="label text-primary-400 mb-3">Chinese Script</p>
          <p className="text-primary-900 text-lg font-medium leading-relaxed whitespace-pre-wrap break-all">{displayChinese}</p>
        </div>
        <div className="card bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={14} className="text-emerald-500" />
            <p className="label text-primary-400 mb-0">Pinyin Script</p>
          </div>
          <p className="text-primary-900 text-lg font-medium leading-relaxed whitespace-pre-wrap break-all">{displayPinyin}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card bg-slate-50 border border-slate-200 space-y-4">
        <div>
          <p className="label text-primary-400 mb-3">Chinese Script</p>
          {step === "correcting" ? (
            <textarea
              className="input resize-none"
              rows={6}
              value={chineseDraft}
              onChange={(e) => setChineseDraft(e.target.value)}
              maxLength={20000}
            />
          ) : (
            <p className="text-primary-900 text-lg font-medium leading-relaxed whitespace-pre-wrap break-all">{task.chineseTranscript}</p>
          )}
        </div>

        <div>
          <p className="label text-primary-400 mb-3">Pinyin Script</p>
          {step === "correcting" ? (
            <textarea
              className="input resize-none"
              rows={6}
              value={pinyinDraft}
              onChange={(e) => setPinyinDraft(e.target.value)}
              maxLength={20000}
            />
          ) : (
            <p className="text-primary-900 text-lg font-medium leading-relaxed whitespace-pre-wrap break-all">{task.pinyin}</p>
          )}
        </div>

        {step === "gate" && (
          <div>
            <p className="text-sm text-black/70 mb-2">Does the Pinyin correctly represent the Chinese transcript?</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => handleVerify(true)} disabled={verifying} className="btn-primary">
                Pinyin Correct — Yes
              </button>
              <button type="button" onClick={() => handleVerify(false)} disabled={verifying} className="btn-secondary">
                No
              </button>
            </div>
          </div>
        )}

        {step === "correcting" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleSaveCorrection} disabled={savingCorrection} className="btn-primary">
              {savingCorrection ? "Saving…" : "Save Correction"}
            </button>
            <button
              type="button"
              onClick={openErroneousModal}
              className="btn-secondary text-red-700 inline-flex items-center gap-1.5"
            >
              <AlertTriangle size={14} /> Mark Erroneous / Invalid
            </button>
          </div>
        )}
      </div>

      {isErroneousModalOpen && (
        <Modal title="Mark Erroneous / Invalid" onClose={() => !markingErroneous && setIsErroneousModalOpen(false)} size="md">
          <form onSubmit={submitErroneous} className="space-y-4">
            <div>
              <p className="text-sm text-black/70 mb-2">
                This marks the item as invalid — it will be excluded from the valid dataset and skipped for recording.
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
