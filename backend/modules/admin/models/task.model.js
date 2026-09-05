const mongoose = require("mongoose");
const Counter = require("./counter.model");

let counterSeeded = false;

const getCurrentMaxTaskSequence = async () => {
  const result = await mongoose.model("Task").aggregate([
    { $match: { taskId: { $type: "string", $regex: "^TASK-\\d+$" } } },
    {
      $project: {
        seq: {
          $toInt: {
            $substrBytes: ["$taskId", 5, -1],
          },
        },
      },
    },
    { $sort: { seq: -1 } },
    { $limit: 1 },
  ]);

  return result[0]?.seq || 0;
};

const ensureTaskCounterSeeded = async () => {
  if (counterSeeded) return;

  const maxSeq = await getCurrentMaxTaskSequence();
  await Counter.findOneAndUpdate(
    { _id: "taskId" },
    { $max: { seq: maxSeq } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  counterSeeded = true;
};

const getNextTaskSequence = async () => {
  await ensureTaskCounterSeeded();

  const counter = await Counter.findOneAndUpdate(
    { _id: "taskId" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return counter.seq;
};

const taskSchema = new mongoose.Schema(
  {
    taskId: {
      type: String,
      unique: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: [true, "Project ID is required"],
    },
    dialogueId: {
      type: String,
      required: [true, "Dialogue ID is required"],
      trim: true,
      maxlength: [200, "Dialogue ID must be at most 200 characters"],
    },
    chineseTranscript: {
      type: String,
      required: [true, "Chinese transcript is required"],
      trim: true,
      maxlength: [20000, "Chinese transcript must be at most 20000 characters"],
    },
    pinyin: {
      type: String,
      required: [true, "Pinyin is required"],
      trim: true,
      maxlength: [20000, "Pinyin must be at most 20000 characters"],
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// One dialogue per project - allows the same source dataset to be split across projects.
taskSchema.index({ projectId: 1, dialogueId: 1 }, { unique: true });
// Speeds up the project's task list and admin/user "tasks by project" lookups.
taskSchema.index({ projectId: 1, createdAt: 1 });

// Auto-generate taskId before save
taskSchema.pre("save", async function (next) {
  if (!this.taskId) {
    const nextSeq = await getNextTaskSequence();
    this.taskId = `TASK-${String(nextSeq).padStart(4, "0")}`;
  }
  next();
});

// insertMany() does not run the "save" middleware above, so bulk-import callers
// must reserve their own taskId block up front and assign it to each doc.
taskSchema.statics.reserveTaskIdBatch = async function (count) {
  await ensureTaskCounterSeeded();

  const counter = await Counter.findOneAndUpdate(
    { _id: "taskId" },
    { $inc: { seq: count } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const endSeq = counter.seq;
  const startSeq = endSeq - count + 1;
  const ids = [];
  for (let seq = startSeq; seq <= endSeq; seq += 1) {
    ids.push(`TASK-${String(seq).padStart(4, "0")}`);
  }
  return ids;
};

module.exports = mongoose.model("Task", taskSchema);
