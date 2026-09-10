const mongoose = require("mongoose");

// One row per annotator per Kolkata calendar day. The nightly cleanup, before
// it deletes the day's finished tasks + audio, folds each user's finished
// counts into their row for that date ($inc, so a second cleanup on the same
// day accumulates instead of overwriting). Progress everywhere is then
// "sum of these rows" + "whatever is still live in TaskSubmission".
//
// Nothing here is ever deleted by the cleanup - this is the permanent record.
const userProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // "YYYY-MM-DD" in Asia/Kolkata.
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    // Finished tasks the annotator was responsible for that were wiped that day.
    assigned: { type: Number, default: 0 },
    submitted: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    discarded: { type: Number, default: 0 },
    edited: { type: Number, default: 0 },
    validated: { type: Number, default: 0 },
    recorded: { type: Number, default: 0 },
    audioDurationSeconds: { type: Number, default: 0 },
    timeSpentMs: { type: Number, default: 0 },

    // Bookkeeping for the cleanup that wrote this row.
    tasksDeleted: { type: Number, default: 0 },
    audioFilesDeleted: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userProgressSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("UserProgress", userProgressSchema);
