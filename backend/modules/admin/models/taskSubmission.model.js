const mongoose = require("mongoose");

const taskSubmissionSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    audio: {
      provider: { type: String, default: null },
      publicId: { type: String, default: null },
      url: { type: String, default: null },
      contentType: { type: String, default: "audio/wav" },
      sampleRate: { type: Number, default: 16000 },
      bitDepth: { type: Number, default: 16 },
      channels: { type: Number, default: 1 },
      durationSeconds: { type: Number, default: 0 },
      uploadedAt: { type: Date, default: null },
      fileSizeBytes: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: [
        "pending",
        "in-progress",
        "verified",
        "corrected",
        "recorded",
        "completed",
        "erroneous",
        "discarded",
        "requires-review",
        "skipped",
      ],
      default: "pending",
      index: true,
    },
    pinyinVerified: {
      type: Boolean,
      default: null,
    },
    correctedChineseTranscript: {
      type: String,
      trim: true,
      maxlength: [20000, "Corrected transcript must be at most 20000 characters"],
      default: "",
    },
    correctedPinyin: {
      type: String,
      trim: true,
      maxlength: [20000, "Corrected pinyin must be at most 20000 characters"],
      default: "",
    },
    isCorrected: {
      type: Boolean,
      default: false,
    },
    erroneous: {
      flagged: { type: Boolean, default: false },
      reason: { type: String, trim: true, maxlength: 1000, default: "" },
      markedAt: { type: Date, default: null },
    },
    // Set when the annotator opens the edit screen and chooses Discard instead
    // of submitting a correction. Reversible via the reconsider action.
    discarded: {
      flagged: { type: Boolean, default: false },
      discardedAt: { type: Date, default: null },
    },
    // How many Chinese characters differ between the source transcript and the
    // annotator's correction - kept so "minor corrections only" can be audited.
    editCharCount: {
      type: Number,
      default: 0,
    },
    audioVerifiedAt: {
      type: Date,
      default: null,
    },
    // Total wall-clock time the annotator has spent on this task across all
    // sessions, accumulated in milliseconds. The client sends short deltas
    // (tab hidden / component unmount / navigation) and the server sums them
    // in via $inc so out-of-order arrivals still add up correctly.
    timeSpentMs: {
      type: Number,
      default: 0,
    },
    reportedIssue: {
      flagged: { type: Boolean, default: false },
      note: { type: String, default: "" },
      reportedAt: { type: Date, default: null },
      adminComment: { type: String, default: "" },
      adminCommentedAt: { type: Date, default: null },
      adminCommentedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
  },
  { timestamps: true }
);

taskSubmissionSchema.index({ taskId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("TaskSubmission", taskSubmissionSchema);
