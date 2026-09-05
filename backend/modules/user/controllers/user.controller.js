const userSvc = require("../services/user.service");
const { getAudioStream } = require("../../../services/audioStorage.service");
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

    return successResponse(res, "Audio uploaded successfully.", {
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
 * Stream the annotator's recorded audio back to their browser. Reads from
 * the local uploads directory (audio.publicId holds the relative path).
 */
const streamAudio = async (req, res, next) => {
  try {
    const task = await userSvc.getTaskDetail(req.params.id, req.user.id);

    if (!task.audio || !task.audio.publicId) {
      return errorResponse(res, "No audio recorded for this task yet.", 404);
    }

    logger.info(`Audio stream | task: ${req.params.id} | user: ${req.user.id} | file: ${task.audio.publicId}`);

    const stream = await getAudioStream(task.audio.publicId);
    res.setHeader("Content-Type", task.audio.contentType || "audio/wav");
    res.setHeader("Content-Disposition", `attachment; filename="${task.taskId}.wav"`);
    stream.pipe(res);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const skipTask = async (req, res, next) => {
  try {
    const task = await userSvc.skipTask(req.params.id, req.user.id);
    return successResponse(res, "Task skipped.", {
      taskId: task.taskId,
      status: task.status,
    });
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const flagTaskIssue = async (req, res, next) => {
  try {
    const note = String(req.body?.note || "").trim();
    const task = await userSvc.flagTaskIssue(req.params.id, req.user.id, note);
    return successResponse(res, "Task issue reported.", {
      taskId: task.taskId,
      reportedIssue: task.reportedIssue || { flagged: true },
    });
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

const markErroneous = async (req, res, next) => {
  try {
    const task = await userSvc.markErroneous(req.params.id, req.user.id, req.body.reason);
    return successResponse(res, "Task marked erroneous.", {
      taskId: task.taskId,
      status: task.status,
      erroneous: task.erroneous,
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
  getProjectTasks,
  getTaskDetail,
  uploadAudio,
  streamAudio,
  skipTask,
  flagTaskIssue,
  verifyPinyin,
  correctTranscript,
  markErroneous,
  discardTask,
  reconsiderTask,
  recordTimeSpent,
  getMyProfile,
  updateMyProfile,
};
