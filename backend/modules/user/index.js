const express = require("express");
const router = express.Router();
const ctrl = require("./controllers/user.controller");
const { authenticate, requireRole } = require("../../middlewares/auth");
const validate = require("../../middlewares/validate");
const { validateObjectId } = require("../../validators/common.validator");
const { verifyPinyinValidator, correctTranscriptValidator } = require("./validators/user.validator");
const { validatePagination } = require("../../validators/common.validator");
const audioUpload = require("./services/audioUpload.service");

// All user routes require authentication + user role
router.use(authenticate, requireRole("user"));

// GET / PATCH /api/user/me - annotator profile (identity + projects + analytics)
router.get("/me", ctrl.getMyProfile);
router.patch("/me", ctrl.updateMyProfile);

// GET /api/user/projects
router.get("/projects", ctrl.getMyProjects);

// GET /api/user/projects/:id/tasks?page&limit&status&search  - paginated
router.get(
  "/projects/:id/tasks",
  [validateObjectId("id"), ...validatePagination, validate],
  ctrl.getProjectTasks
);

// GET /api/user/projects/:id/tasks/summary  - filter-chip counts
router.get("/projects/:id/tasks/summary", [validateObjectId("id"), validate], ctrl.getProjectTaskSummary);

// GET /api/user/projects/:id/next-task  - first unfinished task id
router.get("/projects/:id/next-task", [validateObjectId("id"), validate], ctrl.getNextProjectTask);

// GET /api/user/tasks/:id
router.get("/tasks/:id", [validateObjectId("id"), validate], ctrl.getTaskDetail);

// POST /api/user/tasks/:id/audio  (multipart/form-data, field name: "audio")
router.post(
  "/tasks/:id/audio",
  [validateObjectId("id"), validate],
  audioUpload.single("audio"),
  ctrl.uploadAudio
);

// GET /api/user/tasks/:id/audio  - stream audio directly from Cloudinary
router.get("/tasks/:id/audio", [validateObjectId("id"), validate], ctrl.streamAudio);

// PATCH /api/user/tasks/:id/verify-pinyin
router.patch(
  "/tasks/:id/verify-pinyin",
  [validateObjectId("id"), ...verifyPinyinValidator, validate],
  ctrl.verifyPinyin
);

// PATCH /api/user/tasks/:id/correct
router.patch(
  "/tasks/:id/correct",
  [validateObjectId("id"), ...correctTranscriptValidator, validate],
  ctrl.correctTranscript
);

// POST /api/user/tasks/:id/discard
router.post(
  "/tasks/:id/discard",
  [validateObjectId("id"), validate],
  ctrl.discardTask
);

// POST /api/user/tasks/:id/reconsider
router.post(
  "/tasks/:id/reconsider",
  [validateObjectId("id"), validate],
  ctrl.reconsiderTask
);

// POST /api/user/tasks/:id/time  { ms }  - increments timeSpentMs
router.post(
  "/tasks/:id/time",
  [validateObjectId("id"), validate],
  ctrl.recordTimeSpent
);

module.exports = router;
