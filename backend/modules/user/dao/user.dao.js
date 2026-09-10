const mongoose = require("mongoose");
const Task = require("../../admin/models/task.model");
const Project = require("../../admin/models/project.model");
const ProjectAssignment = require("../../admin/models/projectAssignment.model");
const TaskSubmission = require("../../admin/models/taskSubmission.model");
const User = require("../../register/models/user.model");
const { escapeRegex } = require("../../../services/pagination");

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Terminal per-user submission states - the task is done for this annotator.
const TERMINAL_STATUSES = ["completed", "discarded"];

// Insertion order == taskId order (both come off the same counter). Sorting on
// (createdAt, _id) is index-covered by { projectId: 1, createdAt: 1 } and has
// no TASK-9999 -> TASK-10000 lexical cliff.
const TASK_ORDER = { createdAt: 1, _id: 1 };

const getAssignedProjectIds = async (userId) => {
  const assignments = await ProjectAssignment.find({ userId }).select("projectId").lean();
  return assignments.map((a) => a.projectId);
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

const userHasProject = async (userId, projectId) => {
  return ProjectAssignment.exists({ userId, projectId });
};

const getProjectById = async (projectId) => {
  return Project.findById(projectId);
};

// One $lookup pulls just this annotator's submission (0 or 1 - the
// {taskId,userId} unique index) onto each task so we can filter/sort/page by
// the derived status in Mongo. $facet returns the page and the total in one
// round-trip. List rows carry only what the grid/table renders; full text and
// diff fields load in the task-detail call.
const buildUserTaskPipeline = (userId, projectId, { status, search } = {}) => {
  const match = { projectId: oid(projectId) };
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    match.$or = [{ taskId: rx }, { dialogueId: rx }, { chineseTranscript: rx }, { pinyin: rx }];
  }
  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: TaskSubmission.collection.name,
        let: { tid: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$taskId", "$$tid"] }, { $eq: ["$userId", oid(userId)] }] } } },
          { $project: { status: 1, audio: 1, correctedChineseTranscript: 1, correctedPinyin: 1 } },
        ],
        as: "sub",
      },
    },
    { $addFields: { sub: { $arrayElemAt: ["$sub", 0] } } },
    { $addFields: { status: { $ifNull: ["$sub.status", "pending"] } } },
  ];
  if (status) pipeline.push({ $match: { status } });
  return pipeline;
};

const getTasksForUserByProject = async (
  userId,
  projectId,
  { page = 1, limit = 20, status, search } = {}
) => {
  const skip = (page - 1) * limit;
  const [res] = await Task.aggregate([
    ...buildUserTaskPipeline(userId, projectId, { status, search }),
    { $sort: TASK_ORDER },
    {
      $facet: {
        rows: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              taskId: 1,
              dialogueId: 1,
              chineseTranscript: 1,
              pinyin: 1,
              createdAt: 1,
              status: 1,
              correctedChineseTranscript: { $ifNull: ["$sub.correctedChineseTranscript", ""] },
              correctedPinyin: { $ifNull: ["$sub.correctedPinyin", ""] },
              audio: { $ifNull: ["$sub.audio", null] },
            },
          },
        ],
        meta: [{ $count: "total" }],
      },
    },
  ]);
  return { tasks: res?.rows || [], total: res?.meta?.[0]?.total || 0 };
};

// Filter-chip counts for the project task list. total - submitted = pending.
const getProjectTaskCountsForUser = async (userId, projectId) => {
  const [total, rows] = await Promise.all([
    Task.countDocuments({ projectId }),
    TaskSubmission.aggregate([
      { $match: { projectId: oid(projectId), userId: oid(userId) } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
  ]);
  const byStatus = {
    pending: 0, "in-progress": 0, verified: 0, corrected: 0,
    recorded: 0, completed: 0, discarded: 0,
  };
  let submitted = 0;
  rows.forEach((r) => {
    if (r._id in byStatus) byStatus[r._id] = r.n;
    submitted += r.n;
  });
  byStatus.pending = Math.max(0, total - submitted);
  return { total, byStatus };
};

// First task this annotator has not finished (falls back to the first task).
const getNextTaskForUser = async (userId, projectId) => {
  const [next] = await Task.aggregate([
    ...buildUserTaskPipeline(userId, projectId),
    { $match: { status: { $nin: TERMINAL_STATUSES } } },
    { $sort: TASK_ORDER },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ]);
  if (next) return { taskId: next._id, allFinished: false };
  const first = await Task.findOne({ projectId }).sort(TASK_ORDER).select("_id").lean();
  return { taskId: first?._id || null, allFinished: !!first };
};

// Prev/next task ids + position + completion, for the task-detail screen -
// replaces shipping the whole project task list to the client.
const getTaskNavForUser = async (userId, projectId, currentTask) => {
  const before = {
    projectId,
    $or: [
      { createdAt: { $lt: currentTask.createdAt } },
      { createdAt: currentTask.createdAt, _id: { $lt: currentTask._id } },
    ],
  };
  const after = {
    projectId,
    $or: [
      { createdAt: { $gt: currentTask.createdAt } },
      { createdAt: currentTask.createdAt, _id: { $gt: currentTask._id } },
    ],
  };
  const [total, beforeCount, prev, next, completedCount] = await Promise.all([
    Task.countDocuments({ projectId }),
    Task.countDocuments(before),
    Task.findOne(before).sort({ createdAt: -1, _id: -1 }).select("_id").lean(),
    Task.findOne(after).sort(TASK_ORDER).select("_id").lean(),
    TaskSubmission.countDocuments({ projectId, userId, status: { $in: TERMINAL_STATUSES } }),
  ]);
  return {
    position: beforeCount + 1,
    total,
    prevTaskId: prev?._id || null,
    nextTaskId: next?._id || null,
    completedCount,
    projectFinished: total > 0 && completedCount >= total,
  };
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
  getProjectsForUser,
  userHasProject,
  getProjectById,
  getTasksForUserByProject,
  getProjectTaskCountsForUser,
  getNextTaskForUser,
  getTaskNavForUser,
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
