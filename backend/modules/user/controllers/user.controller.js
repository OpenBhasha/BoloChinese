const userSvc = require("../services/user.service");
const { getAudioStream } = require("../../../services/cloudinary.service");
const { successResponse, errorResponse } = require("../../../responses/apiResponse");
const logger = require("../../../logging/logger");

const getMyTasks = async (req, res, next) => {
  try {
    const tasks = await userSvc.getMyTasks(req.user.id);
    return successResponse(res, "Tasks retrieved.", tasks);
  } catch (err) { next(err); }
};

const getMyProjects = async (req, res, next) => {
  try {
    const projects = await userSvc.getMyProjects(req.user.id);
    return successResponse(res, "Projects retrieved.", projects);
  } catch (err) { next(err); }
};

const getMyStats = async (req, res, next) => {
  try {
    const stats = await userSvc.getMyStats(req.user.id);
    return successResponse(res, "Stats retrieved.", stats);
  } catch (err) { next(err); }
};

const getProjectTasks = async (req, res, next) => {
  try {
    const data = await userSvc.getProjectTasks(req.params.id, req.user.id);
    return successResponse(res, "Project tasks retrieved.", data);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getTaskDetail = async (req, res, next) => {
  try {
    const task = await userSvc.getTaskDetail(req.params.id, req.user.id);
    return successResponse(res, "Task retrieved.", task);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const uploadAudio = async (req, res, next) => {
  try {
    if (!req.file) {
      return errorResponse(res, "Audio file is required. Upload a PCM WAV file.", 400);
    }

    logger.info(
      `Audio upload | task: ${req.params.id} | user: ${req.user.id} | size: ${req.file.size} bytes | mimetype: ${req.file.mimetype}`
    );

    const task = await userSvc.uploadAudio(req.params.id, req.file.buffer, req.user.id, req.file.size);

    return successResponse(res, "Audio uploaded successfully to Cloudinary.", {
      taskId: task.taskId,
      status: task.status,
      audio: {
        provider: task.audio.provider,
        publicId: task.audio.publicId,
        url: task.audio.url,
        contentType: task.audio.contentType,
        sampleRate: task.audio.sampleRate,
        bitDepth: task.audio.bitDepth,
        channels: task.audio.channels,
        uploadedAt: task.audio.uploadedAt,
        fileSizeBytes: task.audio.fileSizeBytes,
      },
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

/**
 * Stream audio from Cloudinary back to the client.
 */
const streamAudio = async (req, res, next) => {
  try {
    const task = await userSvc.getTaskDetail(req.params.id, req.user.id);

    if (!task.audio || !task.audio.url) {
      return errorResponse(res, "No audio recorded for this task yet.", 404);
    }

    logger.info(`Audio stream | task: ${req.params.id} | user: ${req.user.id} | url: ${task.audio.url}`);

    const stream = await getAudioStream(task.audio.url);
    res.setHeader("Content-Type", task.audio.contentType || "audio/wav");
    res.setHeader("Content-Disposition", `attachment; filename="${task.taskId}.wav"`);
    stream.pipe(res);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const verifyPinyin = async (req, res, next) => {
  try {
    const task = await userSvc.verifyPinyin(req.params.id, req.user.id, req.body.correct);
    return successResponse(res, "Pinyin verification recorded.", {
      taskId: task.taskId,
      status: task.status,
      pinyinVerified: task.pinyinVerified,
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const correctTranscript = async (req, res, next) => {
  try {
    const task = await userSvc.correctTranscript(req.params.id, req.user.id, {
      correctedChineseTranscript: req.body.correctedChineseTranscript,
      correctedPinyin: req.body.correctedPinyin,
    });
    return successResponse(res, "Correction saved.", {
      taskId: task.taskId,
      status: task.status,
      correctedChineseTranscript: task.correctedChineseTranscript,
      correctedPinyin: task.correctedPinyin,
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const discardTask = async (req, res, next) => {
  try {
    const task = await userSvc.discardTask(req.params.id, req.user.id);
    return successResponse(res, "Task discarded.", {
      taskId: task.taskId,
      status: task.status,
      discarded: task.discarded,
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const recordTimeSpent = async (req, res, next) => {
  try {
    const ms = Number(req.body?.ms) || 0;
    await userSvc.recordTimeSpent(req.params.id, req.user.id, ms);
    return successResponse(res, "Time recorded.", { ok: true });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const reconsiderTask = async (req, res, next) => {
  try {
    const task = await userSvc.reconsiderTask(req.params.id, req.user.id);
    return successResponse(res, "Task reopened for review.", {
      taskId: task.taskId,
      status: task.status,
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getMyProfile = async (req, res, next) => {
  try {
    const profile = await userSvc.getUserProfile(req.user.id);
    return successResponse(res, "Profile retrieved.", profile);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const updateMyProfile = async (req, res, next) => {
  try {
    const updated = await userSvc.updateUserProfile(req.user.id, req.body || {});
    return successResponse(res, "Profile updated.", updated);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

module.exports = {
  getMyTasks,
  getMyProjects,
  getMyStats,
  getProjectTasks,
  getTaskDetail,
  uploadAudio,
  streamAudio,
  verifyPinyin,
  correctTranscript,
  discardTask,
  reconsiderTask,
  recordTimeSpent,
  getMyProfile,
  updateMyProfile,
};
