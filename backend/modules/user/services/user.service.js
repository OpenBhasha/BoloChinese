const dao = require("../dao/user.dao");
const { uploadAudio, deleteAudio } = require("../../../services/audioStorage.service");
const { assertRecordingFormat } = require("../../../services/wav");
const { measureEdit } = require("../../../services/textDiff");
const config = require("../../../properties/config");
const logger = require("../../../logging/logger");

// Corrections above this fraction of the original transcript are outside the
// "minor corrections only" guideline. We do not block them (annotators may
// still submit), but we log them for auditing.
const HEAVY_EDIT_RATIO = 0.25;

const getMyTasks = async (userId) => {
  return dao.getTasksForUser(userId);
};

const getMyProjects = async (userId) => {
  return dao.getProjectsForUser(userId);
};

const getProjectTasks = async (projectId, userId) => {
  const project = await dao.getProjectById(projectId);
  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }

  const hasAccess = await dao.userHasProject(userId, projectId);
  if (!hasAccess) {
    const err = new Error("Access denied. This project is not assigned to you.");
    err.statusCode = 403;
    throw err;
  }

  const tasks = await dao.getTasksForUserByProject(userId, projectId);
  return { project, tasks };
};

const getTaskDetail = async (taskId, userId) => {
  const task = await dao.getTaskByIdForUser(taskId);
  if (!task) {
    const err = new Error("Task not found.");
    err.statusCode = 404;
    throw err;
  }
  const hasAccess = await dao.userHasProject(userId, task.projectId);
  if (!hasAccess) {
    const err = new Error("Access denied. This project is not assigned to you.");
    err.statusCode = 403;
    throw err;
  }

  const submission = await dao.getTaskSubmissionForUser(taskId, userId);
  return {
    ...task,
    status: submission?.status || "pending",
    audio: submission?.audio || null,
    pinyinVerified: submission?.pinyinVerified ?? null,
    correctedChineseTranscript: submission?.correctedChineseTranscript || "",
    correctedPinyin: submission?.correctedPinyin || "",
    isCorrected: submission?.isCorrected || false,
    editCharCount: submission?.editCharCount || 0,
    erroneous: submission?.erroneous || { flagged: false, reason: "", markedAt: null },
    discarded: submission?.discarded || { flagged: false, discardedAt: null },
    audioVerifiedAt: submission?.audioVerifiedAt || null,
  };
};

const uploadTaskAudio = async (taskId, audioBuffer, userId, fileSize) => {
  // Validate task ownership
  const existing = await getTaskDetail(taskId, userId);

  if (existing.erroneous?.flagged) {
    const err = new Error("This item is marked erroneous. Reconsider it before recording audio.");
    err.statusCode = 400;
    throw err;
  }

  if (existing.discarded?.flagged) {
    const err = new Error("This item was discarded. Reconsider it before recording audio.");
    err.statusCode = 400;
    throw err;
  }

  if (!existing.pinyinVerified && !existing.isCorrected) {
    const err = new Error("Please verify the text (or submit a correction) before recording audio.");
    err.statusCode = 400;
    throw err;
  }

  // Enforce the capture contract: mono 16 kHz 16-bit PCM WAV.
  const header = assertRecordingFormat(audioBuffer, config.audio);
  const durationSeconds = Number(header.durationSeconds.toFixed(3));

  if (existing.audio && existing.audio.publicId) {
    try {
      await deleteAudio(existing.audio.publicId);
    } catch (delErr) {
      logger.warn(`Could not delete old local audio for task ${taskId}: ${delErr.message}`);
    }
  }

  const { publicId, url, fileSizeBytes } = await uploadAudio(audioBuffer, taskId, userId);

  const status = "completed";
  await dao.saveAudio(taskId, existing.projectId, userId, {
    publicId,
    url,
    fileSizeBytes,
    durationSeconds,
    sampleRate: header.sampleRate,
    bitDepth: header.bitsPerSample,
    channels: header.channels,
    status,
  });
  logger.info(
    `Audio saved locally for task ${taskId} | user: ${userId} | file: ${publicId} | ` +
      `${header.sampleRate}Hz/${header.bitsPerSample}bit/${header.channels}ch | ${durationSeconds}s`
  );
  return getTaskDetail(taskId, userId);
};

const skipTask = async (taskId, userId) => {
  const existing = await getTaskDetail(taskId, userId);
  await dao.markTaskSkipped(taskId, existing.projectId, userId);
  return getTaskDetail(taskId, userId);
};

const flagTaskIssue = async (taskId, userId, note = "") => {
  const existing = await getTaskDetail(taskId, userId);
  await dao.reportTaskIssue(taskId, existing.projectId, userId, note);
  return getTaskDetail(taskId, userId);
};

const verifyPinyin = async (taskId, userId, correct) => {
  const existing = await getTaskDetail(taskId, userId);
  await dao.updateSubmissionVerification(taskId, existing.projectId, userId, correct);
  return getTaskDetail(taskId, userId);
};

const correctTranscript = async (taskId, userId, { correctedChineseTranscript, correctedPinyin }) => {
  const existing = await getTaskDetail(taskId, userId);

  const { distance, ratio } = measureEdit(existing.chineseTranscript, correctedChineseTranscript);
  if (ratio > HEAVY_EDIT_RATIO) {
    logger.warn(
      `Heavy transcript edit on task ${taskId} by user ${userId}: ${distance} char changes ` +
        `(${Math.round(ratio * 100)}% of the source). Guideline is minor corrections only.`
    );
  }

  await dao.updateSubmissionCorrection(taskId, existing.projectId, userId, {
    correctedChineseTranscript,
    correctedPinyin,
    editCharCount: distance,
  });
  return getTaskDetail(taskId, userId);
};

const markErroneous = async (taskId, userId, reason) => {
  const existing = await getTaskDetail(taskId, userId);
  await dao.markSubmissionErroneous(taskId, existing.projectId, userId, reason);
  return getTaskDetail(taskId, userId);
};

const discardTask = async (taskId, userId) => {
  const existing = await getTaskDetail(taskId, userId);
  await dao.markSubmissionDiscarded(taskId, existing.projectId, userId);
  logger.info(`Task ${taskId} discarded by user ${userId}.`);
  return getTaskDetail(taskId, userId);
};

const reconsiderTask = async (taskId, userId) => {
  // Validates task existence + project assignment, same as every other user-facing task mutation.
  await getTaskDetail(taskId, userId);
  await dao.reconsiderSubmission(taskId, userId);
  return getTaskDetail(taskId, userId);
};

const recordTimeSpent = async (taskId, userId, deltaMs) => {
  const existing = await getTaskDetail(taskId, userId);
  await dao.incrementTimeSpent(taskId, existing.projectId, userId, deltaMs);
  return { ok: true };
};

// Fields the user (or an admin acting on the user) may edit on the profile.
// Everything else - username, role, verification flags, dedicatedProjectId -
// stays locked.
const PROFILE_EDITABLE_FIELDS = ["name", "phone", "email"];

const getUserProfile = async (userId) => {
  const user = await dao.getUserById(userId);
  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }
  const [projects, analytics] = await Promise.all([
    dao.getProjectsForUser(userId),
    dao.getUserSubmissionAggregate(userId),
  ]);
  return { user, projects, analytics };
};

const updateUserProfile = async (userId, patch = {}) => {
  const clean = {};
  PROFILE_EDITABLE_FIELDS.forEach((k) => {
    if (patch[k] !== undefined) clean[k] = String(patch[k]).trim();
  });
  if (!Object.keys(clean).length) {
    const err = new Error("Nothing to update.");
    err.statusCode = 400;
    throw err;
  }
  if (clean.email !== undefined && !clean.email) {
    const err = new Error("Email cannot be empty.");
    err.statusCode = 400;
    throw err;
  }
  const updated = await dao.updateUserSelfFields(userId, clean);
  if (!updated) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }
  return updated;
};

module.exports = {
  getMyTasks,
  getMyProjects,
  getProjectTasks,
  getTaskDetail,
  uploadAudio: uploadTaskAudio,
  skipTask,
  flagTaskIssue,
  verifyPinyin,
  correctTranscript,
  markErroneous,
  discardTask,
  reconsiderTask,
  recordTimeSpent,
  getUserProfile,
  updateUserProfile,
};
