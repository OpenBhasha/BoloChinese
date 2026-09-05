import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Pencil, Trash2 } from "lucide-react";
import Modal from "../ui/Modal";
import {
  verifyPinyin,
  correctTranscript,
  discardTask,
} from "../../api/user.api";
import { measureEdit, HEAVY_EDIT_RATIO } from "../../utils/textDiff";

// Derives which step to show from the submission state already persisted on the task,
// so reloading or switching tasks resumes exactly where the user left off.
const deriveStep = (task) => {
  if (task.discarded?.flagged) return "discarded";
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
 *   discarded       - terminal, undoable
 */
export default function TranscriptVerification({
  task,
  onTaskUpdate,
  onProjectTaskPatch,
  nextTask,
  prevTask,
  onNavigate,
  readOnly = false,
}) {
  const [step, setStep] = useState(() => deriveStep(task));
  const [verifying, setVerifying] = useState(false);
  const [chineseDraft, setChineseDraft] = useState(task.correctedChineseTranscript || task.chineseTranscript);
  const [pinyinDraft, setPinyinDraft] = useState(task.correctedPinyin || task.pinyin);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [showNoModal, setShowNoModal] = useState(false);

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

  const handleVerifyYes = async () => {
    setVerifying(true);
    try {
      await verifyPinyin(task._id, true);
      onTaskUpdate({ pinyinVerified: true, status: "verified" });
      setStep("ready-to-record");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to record verification.");
    } finally {
      setVerifying(false);
    }
  };

  // "No" opens a modal - the annotator picks Edit (open the editor) or
  // Discard (drop and move on). We don't record verifyPinyin(false) yet:
  // the state change happens along with whichever action they pick.
  const openNoModal = () => setShowNoModal(true);

  const chooseEdit = async () => {
    setShowNoModal(false);
    setVerifying(true);
    try {
      await verifyPinyin(task._id, false);
      onTaskUpdate({ pinyinVerified: false, status: "in-progress" });
      setStep("editing");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to open editor.");
    } finally {
      setVerifying(false);
    }
  };

  const chooseDiscardFromNoModal = async () => {
    setShowNoModal(false);
    setDiscarding(true);
    try {
      await discardTask(task._id);
      onTaskUpdate({ discarded: { flagged: true, discardedAt: new Date().toISOString() }, status: "discarded" });
      // Patch the parent's projectTasks list too so the "N/M Completed"
      // progress bar reflects the discard right away, even before the
      // annotator has moved to another task.
      onProjectTaskPatch?.(task._id, { status: "discarded" });
      toast.success("Task discarded.");
      // Move the annotator on: prefer the next task; if there is no next
      // (they discarded the last one), fall back to the previous task.
      // If neither exists it's a single-task project and the parent will
      // render ProjectFinished off the patched projectTasks list.
      if (onNavigate) {
        if (nextTask) onNavigate(nextTask._id);
        else if (prevTask) onNavigate(prevTask._id);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to discard task.");
    } finally {
      setDiscarding(false);
    }
  };

  const handleSubmitCorrection = async () => {
    if (!chineseDraft.trim() || !pinyinDraft.trim()) {
      toast.error("Chinese and Pinyin text can't be empty.");
      return;
    }

    const chineseChanged = chineseEdit.distance > 0;
    const pinyinChanged = pinyinEdit.distance > 0;

    // No-op submission (draft matches original) - the annotator opened the
    // editor but didn't change anything. Nudge them to make a change or
    // discard the task instead.
    if (!chineseChanged && !pinyinChanged) {
      toast.error("No changes yet. Edit the Chinese and Pinyin, or use Discard to drop this task.");
      return;
    }

    // One-sided edits are never allowed - Chinese and Pinyin must move
    // together (or not at all).
    if (chineseChanged !== pinyinChanged) {
      const other = chineseChanged ? "Pinyin" : "Chinese";
      toast.error(`Edit the ${other} text too - both sides must be updated together.`);
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

  if (step === "discarded") {
    return (
      <div className="card border-red-300 bg-red-50">
        <div className="flex items-start gap-3">
          <Trash2 size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="label text-red-600 mb-1">Task Discarded</p>
            <p className="text-sm text-red-800">
              This task is discarded and locked. Use Previous / Next to move on.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (step === "ready-to-record") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 size={16} />
          <span>
            {readOnly
              ? "Submitted - this task is locked. Use Previous / Next to move on."
              : task.isCorrected
              ? "Correction submitted - recording unlocked."
              : "Text verified - recording unlocked."}
          </span>
        </div>
        <ScriptPanels chinese={displayChinese} pinyin={displayPinyin} editable={false} />
      </div>
    );
  }

  if (step === "editing") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-semibold mb-0.5">Minor corrections only</p>
          <p>
            Fix deleted / missing words and background-noise or transcription artifacts. Don't rewrite the
            sentence. Each Chinese character counts as one word. Chinese and Pinyin must be edited together.
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
              <AlertTriangle size={13} /> Large change - keep edits minor.
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
        </div>
      </div>
    );
  }

  // step === "gate"
  return (
    <>
      <div className="space-y-4">
        <div>
          <p className="label text-primary-400 mb-1">Step 1 - Verify Text</p>
          <p className="text-sm text-black/70">
            Does the Chinese text and its Pinyin accurately represent the source? Choose <b>Yes</b> to start recording,
            or <b>No</b> to edit the text or discard the task.
          </p>
        </div>

        <ScriptPanels chinese={task.chineseTranscript} pinyin={task.pinyin} editable={false} />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleVerifyYes}
            disabled={verifying || discarding}
            className="bg-green-600 hover:bg-green-700 !text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={openNoModal}
            disabled={verifying || discarding}
            className="bg-red-600 hover:bg-red-700 !text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            No
          </button>
        </div>
      </div>

      {showNoModal && (
        <Modal title="What next?" size="md" onClose={() => !verifying && !discarding && setShowNoModal(false)}>
          <div className="space-y-4">
            <p className="text-sm text-black/80">
              You marked the text as inaccurate. Do you want to fix it or drop this task?
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={chooseEdit}
                disabled={verifying || discarding}
                className="rounded-lg border border-primary-200 hover:border-primary-500 bg-white p-4 text-left transition disabled:opacity-50"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Pencil size={16} className="text-primary-700" />
                  <span className="text-sm font-semibold text-primary-900">Edit</span>
                </div>
                <p className="text-xs text-black/60">
                  Open the editor to fix the Chinese and Pinyin, then submit.
                </p>
              </button>
              <button
                type="button"
                onClick={chooseDiscardFromNoModal}
                disabled={verifying || discarding}
                className="rounded-lg border border-red-200 hover:border-red-500 bg-white p-4 text-left transition disabled:opacity-50"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Trash2 size={16} className="text-red-600" />
                  <span className="text-sm font-semibold text-primary-900">Discard</span>
                </div>
                <p className="text-xs text-black/60">
                  Drop this task and move on to the next one.
                </p>
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowNoModal(false)}
                disabled={verifying || discarding}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
