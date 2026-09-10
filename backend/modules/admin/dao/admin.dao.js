const mongoose = require("mongoose");
const User = require("../../register/models/user.model");
const Project = require("../models/project.model");
const Task = require("../models/task.model");
const ProjectAssignment = require("../models/projectAssignment.model");
const TaskSubmission = require("../models/taskSubmission.model");
const UserProgress = require("../models/userProgress.model");
const BackupState = require("../models/backupState.model");
const { kolkataDate } = require("../../../services/datetime");
const { escapeRegex } = require("../../../services/pagination");

// A task submission is "finished" once the annotator is done with it - audio
// uploaded (completed) or explicitly set aside (discarded). Everything else is
// still in flight and survives the nightly cleanup.
const TERMINAL_STATUSES = ["completed", "discarded"];

// Fields the progress ledger accumulates and every progress read sums back up.
const PROGRESS_FIELDS = [
  "assigned", "submitted", "completed", "discarded",
  "edited", "validated", "recorded", "audioDurationSeconds", "timeSpentMs",
];

const zeroProgress = () => Object.fromEntries(PROGRESS_FIELDS.map((f) => [f, 0]));
const addProgress = (a = {}, b = {}) =>
  Object.fromEntries(PROGRESS_FIELDS.map((f) => [f, (a[f] || 0) + (b[f] || 0)]));

// ─── Users ──────────────────────────────────────────────────────────────────

// { deleted: false } = active only (default listing),
// { deleted: true }  = soft-deleted only,
// { deleted: "all" } = both.
const getAllUsers = async ({ deleted = false } = {}) => {
  const filter =
    deleted === "all" ? {} : deleted ? { deletedAt: { $ne: null } } : { deletedAt: null };
  return User.find(filter).select("-password").sort({ createdAt: -1 });
};

const getPendingUsers = async () => {
  return User.find({ isVerified: false, deletedAt: null })
    .select("-password")
    .sort({ createdAt: -1 });
};

const softDeleteUser = async (userId) => {
  return User.findByIdAndUpdate(
    userId,
    { deletedAt: new Date() },
    { new: true }
  ).select("-password");
};

// Soft delete is permanent - there is no restoreUser. Once deletedAt is
// set the account stays inactive forever, and the email/phone/username
// become available to a fresh sign-up thanks to the partial unique indexes
// on the User schema.

const softDeleteUsersBulk = async (ids = []) => {
  if (!ids.length) return { modifiedCount: 0 };
  const res = await User.updateMany(
    { _id: { $in: ids }, deletedAt: null },
    { $set: { deletedAt: new Date() } }
  );
  return { modifiedCount: res.modifiedCount || 0, requestedCount: ids.length };
};

const verifyUser = async (userId) => {
  return User.findByIdAndUpdate(userId, { isVerified: true }, { new: true }).select("-password");
};

const updateUser = async (userId, data) => {
  return User.findByIdAndUpdate(userId, data, { new: true, runValidators: true }).select("-password");
};

const getUserById = async (userId) => {
  return User.findById(userId).select("-password");
};

const getUserByEmail = async (email) => {
  return User.findOne({ email: String(email).trim().toLowerCase() }).select("-password");
};

// ─── Projects ────────────────────────────────────────────────────────────────

const createProject = async (data) => {
  const project = new Project(data);
  return project.save();
};

const getAllProjects = async () => {
  // The Project doc holds a tasks[] array of ObjectIds - excluded from list
  // and detail responses; the client uses taskCount when it needs a length.
  return Project.find().select("-tasks").populate("createdBy", "name email").sort({ createdAt: -1 });
};

const getProjectById = async (id) => {
  // Drop the tasks[] ObjectId array AND the old .populate("tasks") - for a
  // project with 1000+ tasks that populate was returning 300 KB of Chinese
  // and Pinyin text just to render the header card. taskCount is attached
  // via a lightweight countDocuments in the service layer.
  return Project.findById(id).select("-tasks").populate("createdBy", "name email");
};

const getProjectByName = async (name) => {
  return Project.findOne({ name });
};

const updateProject = async (id, data) => {
  return Project.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

// Hard delete. The project doc AND everything scoped to it goes: every task,
// every annotator's submission, the assignment rows, and the `dedicatedProjectId`
// pointer on any user. Nothing is left dangling. Returns the deleted project
// (or null) plus the Cloudinary audio publicIds the caller should purge.
const deleteProject = async (id) => {
  const project = await Project.findById(id);
  if (!project) return { project: null, audioPublicIds: [] };

  const audioPublicIds = await TaskSubmission.find({
    projectId: id,
    "audio.publicId": { $ne: null },
  }).distinct("audio.publicId");

  await Promise.all([
    Task.deleteMany({ projectId: id }),
    TaskSubmission.deleteMany({ projectId: id }),
    ProjectAssignment.deleteMany({ projectId: id }),
    User.updateMany({ dedicatedProjectId: id }, { $set: { dedicatedProjectId: null } }),
  ]);

  await Project.findByIdAndDelete(id);
  return { project, audioPublicIds };
};

// ─── Tasks ───────────────────────────────────────────────────────────────────

const createTask = async (data) => {
  const task = new Task(data);
  const savedTask = await task.save();
  return Task.findById(savedTask._id).populate("assignedTo", "name email");
};

const addTaskToProject = async (projectId, taskId) => {
  return Project.findByIdAndUpdate(projectId, { $push: { tasks: taskId } }, { new: true });
};

const addTasksToProject = async (projectId, taskIds) => {
  return Project.findByIdAndUpdate(projectId, { $push: { tasks: { $each: taskIds } } }, { new: true });
};

const getExistingDialogueIds = async (projectId, dialogueIds) => {
  const existing = await Task.find({ projectId, dialogueId: { $in: dialogueIds } }).select("dialogueId").lean();
  return existing.map((t) => t.dialogueId);
};

// Bulk-insert pre-validated task docs (each { projectId, dialogueId, chineseTranscript, pinyin }),
// reserving a taskId block up front since insertMany() skips the pre("save") hook.
// Uses ordered:false so one bad doc doesn't abort the rest of the batch.
const bulkCreateTasks = async (docs) => {
  if (!docs.length) return { insertedCount: 0, insertedIds: [], writeErrors: [] };

  const taskIds = await Task.reserveTaskIdBatch(docs.length);
  const docsWithIds = docs.map((doc, i) => ({ ...doc, taskId: taskIds[i] }));

  try {
    const inserted = await Task.insertMany(docsWithIds, { ordered: false });
    return { insertedCount: inserted.length, insertedIds: inserted.map((d) => d._id), writeErrors: [] };
  } catch (err) {
    if (err.insertedDocs) {
      return {
        insertedCount: err.insertedDocs.length,
        insertedIds: err.insertedDocs.map((d) => d._id),
        writeErrors: (err.writeErrors || []).map((we) => ({
          index: we.index,
          message: we.errmsg || we.err?.errmsg || "Insert failed.",
        })),
      };
    }
    throw err;
  }
};


const getTaskById = async (id) => {
  return Task.findById(id).populate("assignedTo", "name email");
};

const updateTask = async (id, data) => {
  return Task.findByIdAndUpdate(id, data, { new: true, runValidators: true })
    .populate("assignedTo", "name email");
};

// Hard delete. Strips the id off the project's `tasks` array and drops every
// related submission so nothing dangles. Returns the deleted task (or null)
// plus the Cloudinary audio publicIds the caller should purge.
const deleteTask = async (id) => {
  const task = await Task.findById(id);
  if (!task) return { task: null, audioPublicIds: [] };

  const audioPublicIds = await TaskSubmission.find({
    taskId: id,
    "audio.publicId": { $ne: null },
  }).distinct("audio.publicId");

  await Project.findByIdAndUpdate(task.projectId, { $pull: { tasks: id } });
  await TaskSubmission.deleteMany({ taskId: id });
  await Task.findByIdAndDelete(id);
  return { task, audioPublicIds };
};

// Bulk-delete tasks scoped to a single project. Also strips their ids off
// the project's `tasks` array and drops every related submission so nothing
// dangles. Returns the audio publicIds to purge alongside deletedCount.
const deleteTasksBulk = async (projectId, ids = []) => {
  if (!ids.length) return { deletedCount: 0, audioPublicIds: [] };
  const objectIds = ids;
  const audioPublicIds = await TaskSubmission.find({
    taskId: { $in: objectIds },
    "audio.publicId": { $ne: null },
  }).distinct("audio.publicId");
  const result = await Task.deleteMany({ _id: { $in: objectIds }, projectId });
  await Project.findByIdAndUpdate(projectId, { $pull: { tasks: { $in: objectIds } } });
  await TaskSubmission.deleteMany({ taskId: { $in: objectIds } });
  return { deletedCount: result.deletedCount || 0, audioPublicIds };
};

const assignProjectToUser = async (projectId, userId, adminId) => {
  return ProjectAssignment.findOneAndUpdate(
    { projectId, userId },
    { $set: { assignedBy: adminId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const unassignProjectFromUser = async (projectId, userId) => {
  return ProjectAssignment.findOneAndDelete({ projectId, userId });
};

// Users currently assigned to a project - name, email, username, verified,
// role - plus each annotator's per-project task progress counts.
const getProjectAssignees = async (projectId) => {
  const assignments = await ProjectAssignment.find({ projectId }).lean();
  if (!assignments.length) return [];

  // Assignees list only shows ACTIVE users; deleted accounts vanish from
  // the project's Users tab like they do from every other analytics view.
  const userIds = assignments.map((a) => a.userId);
  const users = await User.find({ _id: { $in: userIds }, deletedAt: null })
    .select("name email username role isVerified createdAt")
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  // Task total for this project - shared across all annotators.
  const totalTasks = await Task.countDocuments({ projectId });

  // Per-user submission stats, scoped to the project.
  const submissions = await TaskSubmission.find({
    projectId,
    userId: { $in: userIds },
  }).select("userId status").lean();

  const statsByUser = new Map();
  submissions.forEach(({ userId, status }) => {
    const key = String(userId);
    const s = statsByUser.get(key) || { completed: 0, inProgress: 0, discarded: 0, skipped: 0, submitted: 0 };
    s.submitted += 1;
    if (status === "completed") s.completed += 1;
    else if (status === "discarded") s.discarded += 1;
    else if (status === "skipped") s.skipped += 1;
    else s.inProgress += 1;
    statsByUser.set(key, s);
  });

  return assignments
    .filter((a) => userById.has(String(a.userId))) // drop assignments whose user is deleted
    .map((a) => {
      const user = userById.get(String(a.userId));
      const stats = statsByUser.get(String(a.userId)) || { completed: 0, inProgress: 0, discarded: 0, skipped: 0, submitted: 0 };
      const pending = Math.max(0, totalTasks - stats.submitted);
      return {
        user,
        assignedAt: a.createdAt || a.updatedAt || null,
        assignedBy: a.assignedBy || null,
        stats: { ...stats, pending, totalTasks },
      };
    });
};

const getAssignedProjectIdsByUser = async (userId) => {
  const assignments = await ProjectAssignment.find({ userId }).select("projectId").lean();
  return assignments.map((a) => a.projectId.toString());
};

// ─── Progress ledger ─────────────────────────────────────────────────────────
// Progress = permanent ledger rows (written by the nightly cleanup, never
// deleted) + whatever is still live in TaskSubmission (this batch's work).
// "lifetime" sums every ledger row; "today" takes only the Kolkata-dated row.

// Live rollup straight off TaskSubmission, grouped by user. Same shape as a
// ledger row so the two just add together.
const getLiveProgressByUser = async (userIds) => {
  const match = userIds ? { userId: { $in: userIds } } : {};
  const rows = await TaskSubmission.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$userId",
        submitted: { $sum: 1 },
        validated: { $sum: { $cond: [{ $eq: ["$pinyinVerified", true] }, 1, 0] } },
        edited: { $sum: { $cond: [{ $eq: ["$isCorrected", true] }, 1, 0] } },
        discarded: { $sum: { $cond: [{ $eq: ["$status", "discarded"] }, 1, 0] } },
        recorded: { $sum: { $cond: [{ $ifNull: ["$audio.url", false] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        audioDurationSeconds: { $sum: { $ifNull: ["$audio.durationSeconds", 0] } },
        timeSpentMs: { $sum: { $ifNull: ["$timeSpentMs", 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r]));
};

// Ledger rows summed per user. Pass a `date` to restrict to that Kolkata day.
const getLedgerByUser = async (userIds, date) => {
  const match = {};
  if (userIds) match.userId = { $in: userIds };
  if (date) match.date = date;
  const group = { _id: "$userId" };
  PROGRESS_FIELDS.forEach((f) => { group[f] = { $sum: `$${f}` }; });
  const rows = await UserProgress.aggregate([{ $match: match }, { $group: group }]);
  return new Map(rows.map((r) => [r._id.toString(), r]));
};

// Whole-ledger grand totals (optionally for one Kolkata day) for the dashboard.
const getLedgerGrandTotals = async (date) => {
  const pipeline = [];
  if (date) pipeline.push({ $match: { date } });
  const group = { _id: null };
  PROGRESS_FIELDS.forEach((f) => { group[f] = { $sum: `$${f}` }; });
  pipeline.push({ $group: group });
  const [row] = await UserProgress.aggregate(pipeline);
  const out = zeroProgress();
  if (row) PROGRESS_FIELDS.forEach((f) => { out[f] = row[f] || 0; });
  return out;
};

// Every ledger row for one user, newest day first - powers the per-user
// progress.csv daily history in a backup.
const getLedgerRowsForUser = async (userId) =>
  UserProgress.find({ userId }).sort({ date: -1 }).lean();

const shapeProgress = (s) => {
  const assigned = s.assigned || 0;
  const submitted = s.submitted || 0;
  const completed = s.completed || 0;
  const discarded = s.discarded || 0;
  const edited = s.edited || 0;
  return {
    assigned,
    submitted,
    completed,
    edited,
    corrected: edited, // legacy alias
    validated: s.validated || 0,
    discarded,
    recorded: s.recorded || 0,
    audioDurationSeconds: Math.round(s.audioDurationSeconds || 0),
    timeSpentMs: Math.round(s.timeSpentMs || 0),
    pending: Math.max(0, assigned - submitted),
    progressPercent: assigned ? Math.round(((completed + discarded) / assigned) * 100) : 0,
  };
};

// Per-user rollup for the admin dashboard's user progress table. Each row
// carries `today` and `lifetime` blocks; the top-level keys mirror `lifetime`
// so existing table columns keep working.
const getPerUserProgress = async () => {
  // Only ACTIVE (non-soft-deleted) annotators appear in progress analytics.
  const users = await User.find({ role: "user", deletedAt: null })
    .select("name email username phone isVerified identityFlagged identityFlagReason createdAt")
    .lean();
  if (!users.length) return [];

  const activeUserIds = users.map((u) => u._id);
  const today = kolkataDate();

  const [assignments, liveByUser, ledgerAllByUser, ledgerTodayByUser, taskCountRows] = await Promise.all([
    ProjectAssignment.find({ userId: { $in: activeUserIds } }).select("userId projectId").lean(),
    getLiveProgressByUser(activeUserIds),
    getLedgerByUser(activeUserIds),
    getLedgerByUser(activeUserIds, today),
    // One grouped count instead of one countDocuments per user.
    Task.aggregate([{ $group: { _id: "$projectId", n: { $sum: 1 } } }]),
  ]);

  const taskCountByProject = new Map(taskCountRows.map((r) => [String(r._id), r.n]));

  const projectIdsByUser = new Map();
  assignments.forEach((a) => {
    const key = a.userId.toString();
    if (!projectIdsByUser.has(key)) projectIdsByUser.set(key, []);
    projectIdsByUser.get(key).push(a.projectId);
  });

  return users.map((u) => {
      const key = u._id.toString();
      const projectIds = projectIdsByUser.get(key) || [];
      const liveAssigned = projectIds.reduce(
        (sum, pid) => sum + (taskCountByProject.get(String(pid)) || 0),
        0
      );

      const live = { ...zeroProgress(), ...(liveByUser.get(key) || {}), assigned: liveAssigned };
      const lifetime = shapeProgress(addProgress(ledgerAllByUser.get(key), live));
      const todayStats = shapeProgress(addProgress(ledgerTodayByUser.get(key), live));

      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        username: u.username,
        phone: u.phone,
        isVerified: u.isVerified,
        identityFlagged: u.identityFlagged,
        identityFlagReason: u.identityFlagReason,
        ...lifetime, // back-compat: top-level == lifetime
        lifetime,
        today: todayStats,
      };
  });
};

// ─── Finished-set + backup/cleanup ───────────────────────────────────────────

// Task ids that are fully finished as of `cutoff`: at least one submission,
// every submission terminal (completed/discarded), and none touched after the
// cutoff. This is exactly what a backup exports and a cleanup deletes.
const getFinishedTaskIds = async (cutoff) => {
  const rows = await TaskSubmission.aggregate([
    {
      $group: {
        _id: "$taskId",
        total: { $sum: 1 },
        terminal: { $sum: { $cond: [{ $in: ["$status", TERMINAL_STATUSES] }, 1, 0] } },
        maxUpdatedAt: { $max: "$updatedAt" },
      },
    },
    {
      $match: {
        $expr: {
          $and: [
            { $gt: ["$total", 0] },
            { $eq: ["$total", "$terminal"] },
            { $lte: ["$maxUpdatedAt", cutoff] },
          ],
        },
      },
    },
    { $project: { _id: 1 } },
  ]);
  return rows.map((r) => r._id);
};

// Everything the zip builder needs for a backup of the finished set as of
// `cutoff`. Users/projects/assignments are included whole for the mapping
// files; tasks and submissions are scoped to the finished set.
const getBackupDataset = async (cutoff) => {
  const finishedTaskIds = await getFinishedTaskIds(cutoff);
  const [tasks, submissions, projects, users, assignments] = await Promise.all([
    Task.find({ _id: { $in: finishedTaskIds } }).lean(),
    TaskSubmission.find({ taskId: { $in: finishedTaskIds } }).lean(),
    Project.find({}).select("name description createdBy createdAt").populate("createdBy", "name email").lean(),
    User.find({})
      .select("name email username phone role isVerified identityFlagged identityFlagReason dedicatedProjectId createdAt deletedAt")
      .lean(),
    ProjectAssignment.find({}).select("projectId userId").lean(),
  ]);
  return { cutoff, finishedTaskIds, tasks, submissions, projects, users, assignments };
};

// Snapshot the finished set into the ledger, then hard-delete it. `cutoff` must
// be the timestamp of the backup the admin just took; `date` is the Kolkata day
// the ledger rows are filed under. Returns a summary + the audio publicIds the
// caller must purge from Cloudinary.
const runCleanupDeletion = async ({ cutoff, date }) => {
  const finishedTaskIds = await getFinishedTaskIds(cutoff);
  if (!finishedTaskIds.length) {
    return { date, tasksDeleted: 0, submissionsDeleted: 0, usersSnapshotted: 0, audioPublicIds: [] };
  }

  const submissions = await TaskSubmission.find({ taskId: { $in: finishedTaskIds } })
    .select("taskId userId status pinyinVerified isCorrected audio.url audio.publicId audio.durationSeconds timeSpentMs")
    .lean();

  const perUser = new Map();
  for (const s of submissions) {
    const key = s.userId.toString();
    const acc = perUser.get(key) || { userId: s.userId, ...zeroProgress() };
    acc.assigned += 1;
    acc.submitted += 1;
    if (s.status === "completed") acc.completed += 1;
    if (s.status === "discarded") acc.discarded += 1;
    if (s.isCorrected) acc.edited += 1;
    if (s.pinyinVerified === true) acc.validated += 1;
    if (s.audio && s.audio.url) acc.recorded += 1;
    acc.audioDurationSeconds += Number(s.audio?.durationSeconds || 0);
    acc.timeSpentMs += Number(s.timeSpentMs || 0);
    perUser.set(key, acc);
  }

  // $inc so a second cleanup on the same Kolkata day accumulates.
  await Promise.all(
    [...perUser.values()].map((acc) =>
      UserProgress.updateOne(
        { userId: acc.userId, date },
        {
          $inc: {
            assigned: acc.assigned,
            submitted: acc.submitted,
            completed: acc.completed,
            discarded: acc.discarded,
            edited: acc.edited,
            validated: acc.validated,
            recorded: acc.recorded,
            audioDurationSeconds: Math.round(acc.audioDurationSeconds),
            timeSpentMs: Math.round(acc.timeSpentMs),
            tasksDeleted: acc.assigned,
            audioFilesDeleted: acc.recorded,
          },
        },
        { upsert: true }
      )
    )
  );

  const audioPublicIds = submissions.map((s) => s.audio?.publicId).filter(Boolean);

  const subDel = await TaskSubmission.deleteMany({ taskId: { $in: finishedTaskIds } });
  await Task.deleteMany({ _id: { $in: finishedTaskIds } });
  await Project.updateMany(
    { tasks: { $in: finishedTaskIds } },
    { $pull: { tasks: { $in: finishedTaskIds } } }
  );

  return {
    date,
    tasksDeleted: finishedTaskIds.length,
    submissionsDeleted: subDel.deletedCount || 0,
    usersSnapshotted: perUser.size,
    audioPublicIds,
  };
};

// ─── Backup <-> cleanup handshake state (singleton) ──────────────────────────
const getBackupState = async () =>
  BackupState.findByIdAndUpdate(
    "singleton",
    { $setOnInsert: { _id: "singleton" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

const setBackupCompleted = async ({ cutoff, stats, hadErrors }) =>
  BackupState.findByIdAndUpdate(
    "singleton",
    { $set: { lastBackupAt: cutoff, lastBackupHadErrors: !!hadErrors, lastBackupStats: stats || null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

const setCleanupCompleted = async ({ stats }) =>
  BackupState.findByIdAndUpdate(
    "singleton",
    { $set: { lastCleanupAt: new Date(), lastCleanupStats: stats || null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

// Lightweight counts for the dashboard card (what a cleanup would remove now).
const getFinishedSetSummary = async (cutoff) => {
  const finishedTaskIds = await getFinishedTaskIds(cutoff);
  if (!finishedTaskIds.length) return { finishedTasks: 0, finishedSubmissions: 0, audioFiles: 0 };
  const [finishedSubmissions, audioFiles] = await Promise.all([
    TaskSubmission.countDocuments({ taskId: { $in: finishedTaskIds } }),
    TaskSubmission.countDocuments({ taskId: { $in: finishedTaskIds }, "audio.publicId": { $ne: null } }),
  ]);
  return { finishedTasks: finishedTaskIds.length, finishedSubmissions, audioFiles };
};

const getUserSubmissions = async (userId) => {
  return TaskSubmission.find({ userId })
    .populate("taskId", "taskId dialogueId chineseTranscript pinyin")
    .populate("projectId", "name")
    .sort({ updatedAt: -1 });
};

const getTaskSubmissions = async (taskId) => {
  return TaskSubmission.find({ taskId })
    .populate("userId", "name email")
    .sort({ updatedAt: -1 });
};

// One page of a project's submissions for the admin project view's Submissions
// tab. $lookup joins task + user so status/search filtering and sorting happen
// in Mongo; $facet returns the page and the total together. `hasAudio` limits
// to recordings (the tab's default). Output shape mirrors the old
// .populate("taskId" / "userId") response so the client join still works.
const getSubmissionsByProject = async (
  projectId,
  { page = 1, limit = 20, status, search, hasAudio = false } = {}
) => {
  const match = { projectId: new mongoose.Types.ObjectId(String(projectId)) };
  if (status) match.status = status;
  if (hasAudio) match["audio.url"] = { $ne: null };

  const pipeline = [
    { $match: match },
    { $lookup: { from: Task.collection.name, localField: "taskId", foreignField: "_id", as: "task" } },
    { $unwind: { path: "$task", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: User.collection.name, localField: "userId", foreignField: "_id", as: "user" } },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  ];

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    pipeline.push({
      $match: {
        $or: [
          { "task.taskId": rx },
          { "task.dialogueId": rx },
          { "user.name": rx },
          { "user.email": rx },
          { status: rx },
        ],
      },
    });
  }

  pipeline.push(
    { $sort: { updatedAt: -1 } },
    {
      $facet: {
        rows: [
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $project: {
              status: 1, updatedAt: 1, createdAt: 1, audio: 1, pinyinVerified: 1,
              isCorrected: 1, correctedChineseTranscript: 1, correctedPinyin: 1,
              editCharCount: 1, discarded: 1, timeSpentMs: 1, audioVerifiedAt: 1,
              taskId: {
                _id: "$task._id", taskId: "$task.taskId", dialogueId: "$task.dialogueId",
                chineseTranscript: "$task.chineseTranscript", pinyin: "$task.pinyin",
              },
              userId: {
                _id: "$user._id", name: "$user.name", email: "$user.email", username: "$user.username",
              },
            },
          },
        ],
        meta: [{ $count: "total" }],
      },
    }
  );

  const [res] = await TaskSubmission.aggregate(pipeline);
  return { items: res?.rows || [], total: res?.meta?.[0]?.total || 0 };
};

// Every submission (any status - partial work included) for a result export.
const getSubmissionsForExport = async (filter = {}) => {
  return TaskSubmission.find(filter)
    .populate("taskId", "taskId dialogueId chineseTranscript pinyin createdAt")
    .populate("projectId", "name")
    .populate("userId", "name email username")
    .sort({ updatedAt: -1 })
    .lean();
};

// Cursor variant for streaming exports - memory stays flat regardless of
// dataset size. Each doc is emitted as a plain object; the writer serialises
// row-by-row to the response.
const getSubmissionsExportCursor = (filter = {}) => {
  return TaskSubmission.find(filter)
    .populate("taskId", "taskId dialogueId chineseTranscript pinyin createdAt")
    .populate("projectId", "name")
    .populate("userId", "name email username")
    .sort({ updatedAt: -1 })
    .lean()
    .cursor();
};

const getTaskSubmissionById = async (submissionId) => {
  return TaskSubmission.findById(submissionId).populate("userId", "name email");
};

const deleteTaskSubmission = async (submissionId) => {
  return TaskSubmission.findByIdAndDelete(submissionId).populate("userId", "name email");
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboardStats = async () => {
  // Everything below counts ACTIVE users only. Soft-deleted accounts and
  // their submissions are excluded from every tile. Project/task deletes now
  // cascade, so submissions are always tied to a live project - no orphan
  // scoping needed.
  const activeUsers = await User.find({ deletedAt: null }).select("_id isVerified identityFlagged").lean();
  const activeUserIds = activeUsers.map((u) => u._id);

  const submissionMatch = { userId: { $in: activeUserIds } };

  const today = kolkataDate();
  const [totalProjects, totalTasks, submissionsByStatus, metrics, ledgerAll, ledgerToday] = await Promise.all([
    Project.countDocuments(),
    Task.estimatedDocumentCount(),
    TaskSubmission.aggregate([
      { $match: submissionMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    TaskSubmission.aggregate([
      { $match: submissionMatch },
      {
        $group: {
          _id: null,
          validated: { $sum: { $cond: [{ $eq: ["$pinyinVerified", true] }, 1, 0] } },
          edited: { $sum: { $cond: [{ $eq: ["$isCorrected", true] }, 1, 0] } },
          discarded: { $sum: { $cond: [{ $eq: ["$status", "discarded"] }, 1, 0] } },
          recorded: { $sum: { $cond: [{ $ifNull: ["$audio.url", false] }, 1, 0] } },
          audioDurationSeconds: { $sum: { $ifNull: ["$audio.durationSeconds", 0] } },
          // Averaged only across submissions where a duration was actually
          // captured, so pending / discarded rows don't drag the mean to 0.
          avgAudioDurationSeconds: {
            $avg: {
              $cond: [
                { $gt: [{ $ifNull: ["$audio.durationSeconds", 0] }, 0] },
                "$audio.durationSeconds",
                null,
              ],
            },
          },
          // Same idea for time-spent: only count submissions the annotator
          // actually opened, otherwise unopened tasks skew the average.
          avgTimePerTaskMs: {
            $avg: {
              $cond: [
                { $gt: [{ $ifNull: ["$timeSpentMs", 0] }, 0] },
                "$timeSpentMs",
                null,
              ],
            },
          },
        },
      },
    ]),
    getLedgerGrandTotals(),
    getLedgerGrandTotals(today),
  ]);

  const totalUsers = activeUsers.length;
  const pendingUsers = activeUsers.filter((u) => !u.isVerified).length;
  const flaggedIdentities = activeUsers.filter((u) => u.identityFlagged).length;

  const statusMap = {};
  submissionsByStatus.forEach((s) => { statusMap[s._id] = s.count; });
  const completed = statusMap["completed"] || 0;
  const corrected = statusMap["corrected"] || 0;
  const discardedStatus = statusMap["discarded"] || 0;
  const inProgress = statusMap["in-progress"] || 0;
  const verified = statusMap["verified"] || 0;
  const submitted = completed + corrected + discardedStatus + inProgress + verified + (statusMap["recorded"] || 0);

  const m = metrics[0] || {};

  // Live = this batch's work still in TaskSubmission. Lifetime = live + every
  // wiped batch recorded in the progress ledger. Today = live + only the
  // Kolkata-dated ledger row. Counts never regress across a nightly cleanup;
  // `total` / `pending` / the averages stay live because they describe the
  // current working set.
  const live = {
    completed,
    edited: m.edited || 0,
    validated: m.validated || 0,
    discarded: m.discarded || 0,
    recorded: m.recorded || 0,
    audioDurationSeconds: Math.round(m.audioDurationSeconds || 0),
  };
  const rollup = (led) => ({
    completed: live.completed + (led.completed || 0),
    edited: live.edited + (led.edited || 0),
    validated: live.validated + (led.validated || 0),
    discarded: live.discarded + (led.discarded || 0),
    recorded: live.recorded + (led.recorded || 0),
    audioDurationSeconds: live.audioDurationSeconds + Math.round(led.audioDurationSeconds || 0),
  });
  const lifetime = rollup(ledgerAll);

  return {
    users: { total: totalUsers, pending: pendingUsers, verified: totalUsers - pendingUsers, flaggedIdentities },
    projects: { total: totalProjects },
    tasks: {
      total: totalTasks,
      // Top-level == lifetime so the dashboard tiles never drop after a cleanup.
      ...lifetime,
      corrected: lifetime.edited,
      avgAudioDurationSeconds: Math.round((m.avgAudioDurationSeconds || 0) * 10) / 10,
      avgTimePerTaskMs: Math.round(m.avgTimePerTaskMs || 0),
      // Rough site-wide indicator only: distinct tasks vs. total per-user submission
      // records can diverge when a project has more than one assigned user. The
      // accurate per-user breakdown lives in getPerUserProgress().
      pending: Math.max(0, totalTasks - submitted),
      live,
      today: rollup(ledgerToday),
      lifetime,
    },
  };
};

module.exports = {
  getAllUsers, getPendingUsers, verifyUser, updateUser,
  softDeleteUser, softDeleteUsersBulk,
  getUserById, getUserByEmail,
  createProject, getAllProjects, getProjectById, getProjectByName, updateProject, deleteProject,
  createTask, addTaskToProject, addTasksToProject, getTaskById, updateTask, deleteTask, deleteTasksBulk,
  getExistingDialogueIds, bulkCreateTasks,
  assignProjectToUser,
  unassignProjectFromUser,
  getAssignedProjectIdsByUser,
  getProjectAssignees,
  getTaskSubmissions,
  getSubmissionsByProject,
  getSubmissionsForExport,
  getSubmissionsExportCursor,
  getTaskSubmissionById,
  deleteTaskSubmission,
  getDashboardStats,
  getPerUserProgress,
  getUserSubmissions,
  // progress ledger + backup/cleanup
  getLiveProgressByUser,
  getLedgerRowsForUser,
  getFinishedTaskIds,
  getBackupDataset,
  runCleanupDeletion,
  getBackupState,
  setBackupCompleted,
  setCleanupCompleted,
  getFinishedSetSummary,
};
