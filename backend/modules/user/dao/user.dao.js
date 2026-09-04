const mongoose = require("mongoose");
const Task = require("../../admin/models/task.model");
const Project = require("../../admin/models/project.model");
const ProjectAssignment = require("../../admin/models/projectAssignment.model");
const TaskSubmission = require("../../admin/models/taskSubmission.model");
const User = require("../../register/models/user.model");

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

const getAssignedProjectIds = async (userId) => {
  const assignments = await ProjectAssignment.find({ userId }).select("projectId").lean();
  return assignments.map((a) => a.projectId);
};

// Per-user working state merged onto the canonical Task fields for list/detail responses.
const mergeSubmissionFields = (submission) => ({
  status: submission?.status || "pending",
  audio: submission?.audio || null,
  pinyinVerified: submission?.pinyinVerified ?? null,
  correctedChineseTranscript: submission?.correctedChineseTranscript || "",
  correctedPinyin: submission?.correctedPinyin || "",
  isCorrected: submission?.isCorrected || false,
  editCharCount: submission?.editCharCount || 0,
  discarded: submission?.discarded || { flagged: false, discardedAt: null },
  audioVerifiedAt: submission?.audioVerifiedAt || null,
});

const getTasksForUser = async (userId) => {
  const projectIds = await getAssignedProjectIds(userId);
  if (!projectIds.length) return [];

  const [tasks, submissions] = await Promise.all([
    Task.find({ projectId: { $in: projectIds } }).lean(),
    TaskSubmission.find({ userId, projectId: { $in: projectIds } }).lean(),
  ]);

  const byTaskId = new Map(submissions.map((s) => [s.taskId.toString(), s]));
  return sortTasksByTaskId(tasks).map((task) => ({
    ...task,
    ...mergeSubmissionFields(byTaskId.get(task._id.toString())),
  }));
};

const getProjectsForUser = async (userId) => {
  const projectIds = await getAssignedProjectIds(userId);
  if (!projectIds.length) return [];

  const [projects, projectTasks, submissions] = await Promise.all([
    Project.find({ _id: { $in: projectIds } }).sort({ createdAt: -1 }).lean(),
    Task.find({ projectId: { $in: projectIds } }).select("_id projectId").lean(),
    TaskSubmission.find({ userId, projectId: { $in: projectIds } }).select("projectId taskId status").lean(),
  ]);

  const taskIdsByProject = new Map();
  projectTasks.forEach((task) => {
    const key = task.projectId.toString();
    if (!taskIdsByProject.has(key)) taskIdsByProject.set(key, new Set());
    taskIdsByProject.get(key).add(task._id.toString());
  });

  const statsByProject = new Map();
  projectIds.forEach((pid) => {
    const key = pid.toString();
    const total = taskIdsByProject.get(key)?.size || 0;
    statsByProject.set(key, { total, completed: 0, inProgress: 0, discarded: 0, pending: total });
  });

  const IN_PROGRESS_STATUSES = new Set(["in-progress", "verified", "corrected", "recorded"]);

  submissions.forEach((s) => {
    const key = s.projectId.toString();
    if (!statsByProject.has(key)) {
      statsByProject.set(key, { total: 0, completed: 0, inProgress: 0, discarded: 0, pending: 0 });
    }
    const stats = statsByProject.get(key);
    if (s.status === "completed") stats.completed += 1;
    else if (s.status === "discarded") stats.discarded += 1;
    else if (IN_PROGRESS_STATUSES.has(s.status)) stats.inProgress += 1;
  });

  statsByProject.forEach((stats) => {
    const done = stats.completed + stats.inProgress + stats.discarded;
    stats.pending = Math.max(0, stats.total - done);
  });

  return projects.map((project) => ({
    ...project,
    stats: statsByProject.get(project._id.toString()) || {
      total: 0,
      completed: 0,
      inProgress: 0,
      discarded: 0,
      pending: 0,
    },
  }));
};

// Self-service rollup for the annotator's "My Stats" page. Mirrors the field
// shape and formulas in admin.dao.getPerUserProgress so a user always sees the
// same numbers an admin sees for them.
const getMyStatsSummary = async (userId) => {
  const projectIds = await getAssignedProjectIds(userId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [assigned, rollup] = await Promise.all([
    projectIds.length ? Task.countDocuments({ projectId: { $in: projectIds } }) : 0,
    TaskSubmission.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: null,
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

  const r = rollup[0] || {};
  const submitted = r.submitted || 0;
  const completed = r.completed || 0;
  const edited = r.edited || 0;
  const validated = r.validated || 0;
  const discarded = r.discarded || 0;
  const erroneous = r.erroneous || 0;
  const requiresReview = r.requiresReview || 0;
  const recorded = r.recorded || 0;
  const audioDurationSeconds = Math.round(r.audioDurationSeconds || 0);
  const pending = Math.max(0, assigned - submitted);
  const progressPercent = assigned
    ? Math.round(((completed + erroneous + discarded) / assigned) * 100)
    : 0;

  return {
    assigned,
    submitted,
    validated,
    edited,
    discarded,
    erroneous,
    requiresReview,
    recorded,
    completed,
    audioDurationSeconds,
    pending,
    progressPercent,
  };
};

const userHasProject = async (userId, projectId) => {
  return ProjectAssignment.exists({ userId, projectId });
};

const getProjectById = async (projectId) => {
  return Project.findById(projectId);
};

const getTasksForUserByProject = async (userId, projectId) => {
  const [tasks, submissions] = await Promise.all([
    Task.find({ projectId }).lean(),
    TaskSubmission.find({ userId, projectId }).lean(),
  ]);

  const byTaskId = new Map(submissions.map((s) => [s.taskId.toString(), s]));

  return sortTasksByTaskId(tasks).map((task) => ({
    ...task,
    ...mergeSubmissionFields(byTaskId.get(task._id.toString())),
  }));
};

const getTaskByIdForUser = async (taskId) => {
  return Task.findById(taskId).lean();
};

const getTaskSubmissionForUser = async (taskId, userId) => {
  return TaskSubmission.findOne({ taskId, userId });
};

const saveAudio = async (
  taskId,
  projectId,
  userId,
  {
    publicId,
    url,
    fileSizeBytes,
    durationSeconds = 0,
    sampleRate = 16000,
    bitDepth = 16,
    channels = 1,
    status,
  }
) => {
  return TaskSubmission.findOneAndUpdate(
    { taskId, userId },
    {
      $set: {
        taskId,
        projectId,
        userId,
        status,
        audioVerifiedAt: new Date(),
        "audio.provider": "cloudinary",
        "audio.publicId": publicId,
        "audio.url": url,
        "audio.contentType": "audio/wav",
        "audio.sampleRate": sampleRate,
        "audio.bitDepth": bitDepth,
        "audio.channels": channels,
        "audio.durationSeconds": durationSeconds,
        "audio.uploadedAt": new Date(),
        "audio.fileSizeBytes": fileSizeBytes,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const updateSubmissionVerification = async (taskId, projectId, userId, pinyinVerified) => {
  return TaskSubmission.findOneAndUpdate(
    { taskId, userId },
    {
      $set: {
        taskId,
        projectId,
        userId,
        pinyinVerified,
        status: pinyinVerified ? "verified" : "in-progress",
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const updateSubmissionCorrection = async (
  taskId,
  projectId,
  userId,
  { correctedChineseTranscript, correctedPinyin, editCharCount = 0 }
) => {
  return TaskSubmission.findOneAndUpdate(
    { taskId, userId },
    {
      $set: {
        taskId,
        projectId,
        userId,
        correctedChineseTranscript,
        correctedPinyin,
        editCharCount,
        isCorrected: true,
        pinyinVerified: false,
        status: "corrected",
        "discarded.flagged": false,
        "discarded.discardedAt": null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const markSubmissionDiscarded = async (taskId, projectId, userId) => {
  return TaskSubmission.findOneAndUpdate(
    { taskId, userId },
    {
      $set: {
        taskId,
        projectId,
        userId,
        status: "discarded",
        "discarded.flagged": true,
        "discarded.discardedAt": new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

// Increment the annotator's wall-clock time on this task. Upserts a
// submission stub if one doesn't exist yet (e.g. time recorded before any
// verification action).
const incrementTimeSpent = async (taskId, projectId, userId, deltaMs) => {
  const ms = Math.max(0, Math.round(Number(deltaMs) || 0));
  if (!ms) return null;
  return TaskSubmission.findOneAndUpdate(
    { taskId, userId },
    {
      $inc: { timeSpentMs: ms },
      $setOnInsert: { taskId, projectId, userId, status: "in-progress" },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const reconsiderSubmission = async (taskId, userId) => {
  return TaskSubmission.findOneAndUpdate(
    { taskId, userId },
    {
      $set: {
        "discarded.flagged": false,
        "discarded.discardedAt": null,
        pinyinVerified: null,
        isCorrected: false,
        status: "in-progress",
      },
    },
    { new: true }
  );
};

const getUserById = async (userId) => {
  return User.findById(userId)
    .select("-password -__v")
    .lean();
};

const updateUserSelfFields = async (userId, patch) => {
  return User.findByIdAndUpdate(userId, { $set: patch }, { new: true, runValidators: true })
    .select("-password -__v")
    .lean();
};

// Aggregate submission stats for a single user across all their assigned
// projects. Used by both the annotator's own profile and the admin's
// user-profile view.
const getUserSubmissionAggregate = async (userId) => {
  const submissions = await TaskSubmission.find({ userId })
    .select("status audio.durationSeconds editCharCount timeSpentMs")
    .lean();

  const stats = {
    totalSubmissions: submissions.length,
    completed: 0,
    inProgress: 0,
    corrected: 0,
    verified: 0,
    discarded: 0,
  };
  let audioCount = 0;
  let audioSeconds = 0;
  let totalEditChars = 0;

  // Per-task time distribution. We only consider tasks with tracked time
  // (> 0 ms) so the average isn't dragged to zero by rows the client never
  // reported time for.
  let timeSum = 0;
  let timeSamples = 0;
  let timeMin = Infinity;
  let timeMax = 0;

  submissions.forEach((s) => {
    if (s.status === "completed") stats.completed += 1;
    else if (s.status === "corrected") stats.corrected += 1;
    else if (s.status === "verified") stats.verified += 1;
    else if (s.status === "discarded") stats.discarded += 1;
    else stats.inProgress += 1;

    const seconds = Number(s.audio?.durationSeconds || 0);
    if (seconds > 0) {
      audioCount += 1;
      audioSeconds += seconds;
    }
    totalEditChars += Number(s.editCharCount || 0);

    const ms = Number(s.timeSpentMs || 0);
    if (ms > 0) {
      timeSum += ms;
      timeSamples += 1;
      if (ms < timeMin) timeMin = ms;
      if (ms > timeMax) timeMax = ms;
    }
  });

  const timePerTask = timeSamples
    ? {
        samples: timeSamples,
        avgMs: Math.round(timeSum / timeSamples),
        minMs: timeMin,
        maxMs: timeMax,
        totalMs: timeSum,
      }
    : { samples: 0, avgMs: 0, minMs: 0, maxMs: 0, totalMs: 0 };

  return {
    ...stats,
    audio: { count: audioCount, totalSeconds: Math.round(audioSeconds) },
    totalEditChars,
    timePerTask,
  };
};

module.exports = {
  getTasksForUser,
  getProjectsForUser,
  getMyStatsSummary,
  userHasProject,
  getProjectById,
  getTasksForUserByProject,
  getTaskByIdForUser,
  getTaskSubmissionForUser,
  saveAudio,
  updateSubmissionVerification,
  updateSubmissionCorrection,
  markSubmissionDiscarded,
  reconsiderSubmission,
  incrementTimeSpent,
  getUserById,
  updateUserSelfFields,
  getUserSubmissionAggregate,
};
