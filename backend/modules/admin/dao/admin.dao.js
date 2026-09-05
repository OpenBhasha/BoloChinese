const User = require("../../register/models/user.model");
const Project = require("../models/project.model");
const Task = require("../models/task.model");
const ProjectAssignment = require("../models/projectAssignment.model");
const TaskSubmission = require("../models/taskSubmission.model");

const getTaskSequence = (taskId = "") => {
  const match = String(taskId).match(/^TASK-(\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const sortTasksByTaskId = (tasks = []) => {
  return [...tasks].sort((a, b) => {
    const aSeq = getTaskSequence(a.taskId);
    const bSeq = getTaskSequence(b.taskId);
    if (aSeq !== bSeq) return aSeq - bSeq;
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  });
};

// ─── Users ──────────────────────────────────────────────────────────────────

const getAllUsers = async () => {
  return User.find().select("-password").sort({ createdAt: -1 });
};

const getPendingUsers = async () => {
  return User.find({ isVerified: false }).select("-password").sort({ createdAt: -1 });
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
  return Project.find().populate("createdBy", "name email").sort({ createdAt: -1 });
};

const getProjectById = async (id) => {
  return Project.findById(id).populate("createdBy", "name email").populate("tasks");
};

const getProjectByName = async (name) => {
  return Project.findOne({ name });
};

const updateProject = async (id, data) => {
  return Project.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

const deleteProject = async (id) => {
  return Project.findByIdAndDelete(id);
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

// Order of submission statuses from "most advanced" to "least advanced".
// Used to pick a single representative status per task when the project has
// multiple annotators and therefore multiple submissions per task.
const STATUS_RANK = [
  "completed",
  "corrected",
  "verified",
  "recorded",
  "in-progress",
  "erroneous",
  "requires-review",
  "discarded",
  "skipped",
  "pending",
];
const STATUS_INDEX = new Map(STATUS_RANK.map((s, i) => [s, i]));

const getTasksByProject = async (projectId) => {
  const tasks = await Task.find({ projectId })
    .populate("assignedTo", "name email")
    .lean();

  if (!tasks.length) return [];

  // Aggregate submission statuses per task in one round-trip.
  const taskIds = tasks.map((t) => t._id);
  const submissions = await TaskSubmission.find({ taskId: { $in: taskIds } })
    .select("taskId status")
    .lean();

  const bestByTask = new Map();
  submissions.forEach(({ taskId, status }) => {
    const key = String(taskId);
    const rank = STATUS_INDEX.get(status) ?? STATUS_RANK.length;
    const current = bestByTask.get(key);
    if (!current || rank < current.rank) {
      bestByTask.set(key, { status, rank });
    }
  });

  const enriched = tasks.map((task) => ({
    ...task,
    overallStatus: bestByTask.get(String(task._id))?.status || "pending",
  }));

  return sortTasksByTaskId(enriched);
};

const getTaskById = async (id) => {
  return Task.findById(id).populate("assignedTo", "name email");
};

const updateTask = async (id, data) => {
  return Task.findByIdAndUpdate(id, data, { new: true, runValidators: true })
    .populate("assignedTo", "name email");
};

const deleteTask = async (id) => {
  return Task.findByIdAndDelete(id);
};

// Bulk-delete tasks scoped to a single project. Also strips their ids off
// the project's `tasks` array and drops every related submission so nothing
// dangles.
const deleteTasksBulk = async (projectId, ids = []) => {
  if (!ids.length) return { deletedCount: 0 };
  const objectIds = ids;
  const result = await Task.deleteMany({ _id: { $in: objectIds }, projectId });
  await Project.findByIdAndUpdate(projectId, { $pull: { tasks: { $in: objectIds } } });
  await TaskSubmission.deleteMany({ taskId: { $in: objectIds } });
  return { deletedCount: result.deletedCount || 0 };
};

const removeTaskFromProject = async (projectId, taskId) => {
  return Project.findByIdAndUpdate(projectId, { $pull: { tasks: taskId } }, { new: true });
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

  const userIds = assignments.map((a) => a.userId);
  const users = await User.find({ _id: { $in: userIds } })
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

  return assignments.map((a) => {
    const user = userById.get(String(a.userId));
    const stats = statsByUser.get(String(a.userId)) || { completed: 0, inProgress: 0, discarded: 0, skipped: 0, submitted: 0 };
    const pending = Math.max(0, totalTasks - stats.submitted);
    return {
      user: user || { _id: a.userId, name: "Unknown user" },
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

// Per-user rollup for the admin dashboard's user progress table.
const getPerUserProgress = async () => {
  const users = await User.find({ role: "user" })
    .select("name email username phone isVerified identityFlagged identityFlagReason createdAt")
    .lean();
  if (!users.length) return [];

  const [assignments, rollup] = await Promise.all([
    ProjectAssignment.find({}).select("userId projectId").lean(),
    TaskSubmission.aggregate([
      {
        $group: {
          _id: "$userId",
          submitted: { $sum: 1 },
          validated: { $sum: { $cond: [{ $eq: ["$pinyinVerified", true] }, 1, 0] } },
          edited: { $sum: { $cond: [{ $eq: ["$isCorrected", true] }, 1, 0] } },
          discarded: { $sum: { $cond: [{ $eq: ["$status", "discarded"] }, 1, 0] } },
          erroneous: { $sum: { $cond: [{ $eq: ["$status", "erroneous"] }, 1, 0] } },
          requiresReview: { $sum: { $cond: [{ $eq: ["$status", "requires-review"] }, 1, 0] } },
          recorded: { $sum: { $cond: [{ $ifNull: ["$audio.url", false] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          audioDurationSeconds: { $sum: { $ifNull: ["$audio.durationSeconds", 0] } },
        },
      },
    ]),
  ]);

  const projectIdsByUser = new Map();
  assignments.forEach((a) => {
    const key = a.userId.toString();
    if (!projectIdsByUser.has(key)) projectIdsByUser.set(key, []);
    projectIdsByUser.get(key).push(a.projectId);
  });

  const rollupByUser = new Map(rollup.map((row) => [row._id.toString(), row]));

  return Promise.all(
    users.map(async (u) => {
      const key = u._id.toString();
      const projectIds = projectIdsByUser.get(key) || [];
      const assigned = projectIds.length ? await Task.countDocuments({ projectId: { $in: projectIds } }) : 0;

      const r = rollupByUser.get(key) || {};
      const completed = r.completed || 0;
      const edited = r.edited || 0;
      const validated = r.validated || 0;
      const discarded = r.discarded || 0;
      const erroneous = r.erroneous || 0;
      const requiresReview = r.requiresReview || 0;
      const recorded = r.recorded || 0;
      const audioDurationSeconds = Math.round(r.audioDurationSeconds || 0);
      const submitted = r.submitted || 0;
      const pending = Math.max(0, assigned - submitted);
      const progressPercent = assigned
        ? Math.round(((completed + erroneous + discarded) / assigned) * 100)
        : 0;

      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        username: u.username,
        phone: u.phone,
        isVerified: u.isVerified,
        identityFlagged: u.identityFlagged,
        identityFlagReason: u.identityFlagReason,
        assigned,
        completed,
        // `corrected` kept as an alias of `edited` for backward compatibility.
        corrected: edited,
        edited,
        validated,
        discarded,
        erroneous,
        requiresReview,
        recorded,
        audioDurationSeconds,
        pending,
        progressPercent,
      };
    })
  );
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

// Every submission (any status - partial work included) for a result export.
const getSubmissionsForExport = async (filter = {}) => {
  return TaskSubmission.find(filter)
    .populate("taskId", "taskId dialogueId chineseTranscript pinyin createdAt")
    .populate("projectId", "name")
    .populate("userId", "name email username")
    .sort({ updatedAt: -1 })
    .lean();
};

const getTaskSubmissionById = async (submissionId) => {
  return TaskSubmission.findById(submissionId).populate("userId", "name email");
};

const deleteTaskSubmission = async (submissionId) => {
  return TaskSubmission.findByIdAndDelete(submissionId).populate("userId", "name email");
};

const addAdminCommentToFlag = async (submissionId, comment, adminId) => {
  return TaskSubmission.findByIdAndUpdate(
    submissionId,
    {
      $set: {
        "reportedIssue.adminComment": comment,
        "reportedIssue.adminCommentedAt": new Date(),
        "reportedIssue.adminCommentedBy": adminId,
      },
    },
    { new: true }
  ).populate("userId", "name email");
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboardStats = async () => {
  const [totalUsers, pendingUsers, flaggedIdentities, totalProjects, totalTasks, submissionsByStatus, metrics] =
    await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isVerified: false }),
      User.countDocuments({ identityFlagged: true }),
      Project.countDocuments(),
      Task.countDocuments(),
      TaskSubmission.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      TaskSubmission.aggregate([
        {
          $group: {
            _id: null,
            validated: { $sum: { $cond: [{ $eq: ["$pinyinVerified", true] }, 1, 0] } },
            edited: { $sum: { $cond: [{ $eq: ["$isCorrected", true] }, 1, 0] } },
            discarded: { $sum: { $cond: [{ $eq: ["$status", "discarded"] }, 1, 0] } },
            recorded: { $sum: { $cond: [{ $ifNull: ["$audio.url", false] }, 1, 0] } },
            audioDurationSeconds: { $sum: { $ifNull: ["$audio.durationSeconds", 0] } },
          },
        },
      ]),
    ]);

  const statusMap = {};
  submissionsByStatus.forEach((s) => { statusMap[s._id] = s.count; });
  const completed = statusMap["completed"] || 0;
  const corrected = statusMap["corrected"] || 0;
  const erroneous = statusMap["erroneous"] || 0;
  const discardedStatus = statusMap["discarded"] || 0;
  const requiresReview = statusMap["requires-review"] || 0;
  const inProgress = statusMap["in-progress"] || 0;
  const verified = statusMap["verified"] || 0;
  const submitted = completed + corrected + erroneous + discardedStatus + requiresReview + inProgress + verified + (statusMap["recorded"] || 0) + (statusMap["skipped"] || 0);

  const m = metrics[0] || {};

  return {
    users: { total: totalUsers, pending: pendingUsers, verified: totalUsers - pendingUsers, flaggedIdentities },
    projects: { total: totalProjects },
    tasks: {
      total: totalTasks,
      completed,
      corrected,
      validated: m.validated || 0,
      edited: m.edited || 0,
      discarded: m.discarded || 0,
      recorded: m.recorded || 0,
      audioDurationSeconds: Math.round(m.audioDurationSeconds || 0),
      erroneous,
      requiresReview,
      // Rough site-wide indicator only: distinct tasks vs. total per-user submission
      // records can diverge when a project has more than one assigned user. The
      // accurate per-user breakdown lives in getPerUserProgress().
      pending: Math.max(0, totalTasks - submitted),
    },
  };
};

module.exports = {
  getAllUsers, getPendingUsers, verifyUser, updateUser,
  getUserById, getUserByEmail,
  createProject, getAllProjects, getProjectById, getProjectByName, updateProject, deleteProject,
  createTask, addTaskToProject, addTasksToProject, getTasksByProject, getTaskById, updateTask, deleteTask, deleteTasksBulk, removeTaskFromProject,
  getExistingDialogueIds, bulkCreateTasks,
  assignProjectToUser,
  unassignProjectFromUser,
  getAssignedProjectIdsByUser,
  getProjectAssignees,
  getTaskSubmissions,
  getSubmissionsForExport,
  getTaskSubmissionById,
  deleteTaskSubmission,
  addAdminCommentToFlag,
  getDashboardStats,
  getPerUserProgress,
  getUserSubmissions,
};
