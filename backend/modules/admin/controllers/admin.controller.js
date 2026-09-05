const path = require("path");
const svc = require("../services/admin.service");
const { successResponse, errorResponse, notFoundResponse } = require("../../../responses/apiResponse");
const logger = require("../../../logging/logger");

// ─── Dashboard ────────────────────────────────────────────────────────────────
const getDashboard = async (req, res, next) => {
  try {
    const stats = await svc.getDashboard();
    return successResponse(res, "Dashboard stats retrieved.", stats);
  } catch (err) { next(err); }
};

const getUsersProgress = async (req, res, next) => {
  try {
    const progress = await svc.getUsersProgress();
    return successResponse(res, "User progress retrieved.", progress);
  } catch (err) { next(err); }
};

// ─── Users ────────────────────────────────────────────────────────────────────
const getUserSubmissions = async (req, res, next) => {
  try {
    const submissions = await svc.getUserSubmissions(req.params.id);
    return successResponse(res, "User submissions retrieved.", submissions);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getAllUsers = async (req, res, next) => {
  try {
    const users = await svc.getAllUsers({ deleted: req.query.deleted });
    return successResponse(res, "Users retrieved.", users);
  } catch (err) { next(err); }
};

const deleteUser = async (req, res, next) => {
  try {
    const user = await svc.deleteUser(req.params.id, req.user.id);
    return successResponse(res, "User deactivated.", user);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const bulkDeleteUsers = async (req, res, next) => {
  try {
    const result = await svc.bulkDeleteUsers(req.body?.ids || [], req.user.id);
    return successResponse(res, `${result.modifiedCount} user(s) deactivated.`, result);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getPendingUsers = async (req, res, next) => {
  try {
    const users = await svc.getPendingUsers();
    return successResponse(res, "Pending users retrieved.", users);
  } catch (err) { next(err); }
};

const verifyUser = async (req, res, next) => {
  try {
    logger.info(`Admin ${req.user.id} verifying user ${req.params.id}`);
    const user = await svc.verifyUser(req.params.id, req.user.id);
    return successResponse(res, "User verified successfully. A dedicated project was created for them.", user);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const updateUser = async (req, res, next) => {
  try {
    logger.info(`Admin ${req.user.id} updating user ${req.params.id}`);
    const user = await svc.updateUser(req.params.id, req.body);
    return successResponse(res, "User updated successfully.", user);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const assignProjectToUser = async (req, res, next) => {
  try {
    logger.info(`Admin ${req.user.id} assigning project ${req.params.projectId} to user ${req.params.userId}`);
    const result = await svc.assignProjectToUser(req.params.projectId, req.params.userId, req.user.id);
    return successResponse(res, "Project assigned successfully.", result);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const unassignProjectFromUser = async (req, res, next) => {
  try {
    logger.info(`Admin ${req.user.id} unassigning project ${req.params.projectId} from user ${req.params.userId}`);
    const result = await svc.unassignProjectFromUser(req.params.projectId, req.params.userId, req.user.id);
    return successResponse(res, "Project unassigned successfully.", result);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getUserProfile = async (req, res, next) => {
  try {
    const userSvc = require("../../user/services/user.service");
    const profile = await userSvc.getUserProfile(req.params.id);
    return successResponse(res, "User profile retrieved.", profile);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getProjectAssignees = async (req, res, next) => {
  try {
    const assignees = await svc.getProjectAssignees(req.params.projectId);
    return successResponse(res, "Project assignees retrieved.", assignees);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getAssignedProjectIdsByUser = async (req, res, next) => {
  try {
    const assignedProjectIds = await svc.getAssignedProjectIdsByUser(req.params.userId);
    return successResponse(res, "Assigned projects retrieved.", assignedProjectIds);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

// ─── Projects ─────────────────────────────────────────────────────────────────
const createProject = async (req, res, next) => {
  try {
    const project = await svc.createProject({ ...req.body, adminId: req.user.id });
    return successResponse(res, "Project created.", project, 201);
  } catch (err) { next(err); }
};

const getAllProjects = async (req, res, next) => {
  try {
    const projects = await svc.getAllProjects();
    return successResponse(res, "Projects retrieved.", projects);
  } catch (err) { next(err); }
};

const getProjectById = async (req, res, next) => {
  try {
    const project = await svc.getProjectById(req.params.id);
    return successResponse(res, "Project retrieved.", project);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const updateProject = async (req, res, next) => {
  try {
    const project = await svc.updateProject(req.params.id, req.body);
    return successResponse(res, "Project updated.", project);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const deleteProject = async (req, res, next) => {
  try {
    await svc.deleteProject(req.params.id);
    return successResponse(res, "Project deleted successfully.", null);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

// ─── Tasks ────────────────────────────────────────────────────────────────────
const createTask = async (req, res, next) => {
  try {
    const task = await svc.createTask({ projectId: req.params.projectId, ...req.body });
    return successResponse(res, "Task created.", task, 201);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const uploadTasksImport = async (req, res, next) => {
  try {
    if (!req.file) {
      return errorResponse(res, "A file is required. Upload .xlsx, .xls, or .csv.", 400);
    }

    const fileExtension = path.extname(req.file.originalname || "").toLowerCase();
    const result = await svc.createTasksFromImport(req.params.projectId, req.file.buffer, fileExtension);
    const message = result.failedCount
      ? `Uploaded with partial success. Created ${result.createdCount} of ${result.totalRows} tasks.`
      : `Successfully created ${result.createdCount} tasks.`;

    return successResponse(res, message, result, 201);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getTasksByProject = async (req, res, next) => {
  try {
    const tasks = await svc.getTasksByProject(req.params.projectId);
    return successResponse(res, "Tasks retrieved.", tasks);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getTaskById = async (req, res, next) => {
  try {
    const task = await svc.getTaskById(req.params.id);
    return successResponse(res, "Task retrieved.", task);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const updateTask = async (req, res, next) => {
  try {
    const task = await svc.updateTask(req.params.id, req.body);
    return successResponse(res, "Task updated.", task);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const deleteTasksBulk = async (req, res, next) => {
  try {
    const result = await svc.deleteTasksBulk(req.params.projectId, req.body?.ids || []);
    return successResponse(res, `${result.deletedCount} task(s) deleted.`, result);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const deleteTask = async (req, res, next) => {
  try {
    await svc.deleteTask(req.params.id);
    return successResponse(res, "Task deleted successfully.", null);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getSubmissionsByProject = async (req, res, next) => {
  try {
    const submissions = await svc.getSubmissionsByProject(req.params.projectId);
    return successResponse(res, "Project submissions retrieved.", submissions);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const getTaskSubmissions = async (req, res, next) => {
  try {
    const submissions = await svc.getTaskSubmissions(req.params.id);
    return successResponse(res, "Task submissions retrieved.", submissions);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const streamSubmissionAudio = async (req, res, next) => {
  try {
    const submission = await svc.getTaskSubmissionById(req.params.id);
    if (!submission.audio || !submission.audio.url) {
      return errorResponse(res, "No audio found for this submission.", 404);
    }

    const { getAudioStream } = require("../../../services/cloudinary.service");
    const stream = await getAudioStream(submission.audio.url);

    res.setHeader("Content-Type", submission.audio.contentType || "audio/wav");
    res.setHeader("Content-Disposition", `attachment; filename="submission-${submission._id}.wav"`);
    stream.pipe(res);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

const deleteSubmission = async (req, res, next) => {
  try {
    await svc.deleteTaskSubmission(req.params.id);
    return successResponse(res, "Submission deleted successfully.", null);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

// ─── Result export (streaming) ───────────────────────────────────────────────
// Row-by-row streaming keeps memory flat regardless of dataset size. First
// byte reaches the client in milliseconds, and downloads of hundreds of
// thousands of rows no longer OOM the Node process or block other requests
// behind one giant 30+ second call.
const { csvHeaderLine, csvRowLine } = require("../../../services/csv");

const streamCsvExport = async (res, scope) => {
  const { filename, columns, cursor, toRow } = await svc.prepareStreamingExport(scope);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // UTF-8 BOM so Excel opens Chinese content correctly.
  res.write("\uFEFF");
  res.write(csvHeaderLine(columns));

  let count = 0;
  try {
    for await (const submission of cursor) {
      res.write(csvRowLine(columns, toRow(submission)));
      count += 1;
    }
  } catch (err) {
    logger.error(`Export stream failed after ${count} rows: ${err.message}`);
    res.end();
    return;
  }
  logger.info(`Results exported (streamed) | rows: ${count} | file: ${filename}`);
  res.end();
};

const exportResults = async (req, res, next) => {
  try {
    const { projectId, userId } = req.query;
    return await streamCsvExport(res, { projectId, userId });
  } catch (err) {
    if (err.statusCode && !res.headersSent) return errorResponse(res, err.message, err.statusCode);
    if (!res.headersSent) next(err);
  }
};

const exportProjectResults = async (req, res, next) => {
  try {
    return await streamCsvExport(res, { projectId: req.params.projectId });
  } catch (err) {
    if (err.statusCode && !res.headersSent) return errorResponse(res, err.message, err.statusCode);
    if (!res.headersSent) next(err);
  }
};

const exportUserResults = async (req, res, next) => {
  try {
    return await streamCsvExport(res, { userId: req.params.id });
  } catch (err) {
    if (err.statusCode && !res.headersSent) return errorResponse(res, err.message, err.statusCode);
    if (!res.headersSent) next(err);
  }
};

const addAdminCommentToFlag = async (req, res, next) => {
  try {
    const adminComment = String(req.body?.adminComment || "").trim();
    if (!adminComment) {
      return errorResponse(res, "Admin comment is required.", 400);
    }

    const submission = await svc.addAdminCommentToFlag(req.params.id, adminComment, req.user.id);
    return successResponse(res, "Admin comment added.", submission);
  } catch (err) {
    if (err.statusCode) return errorResponse(res, err.message, err.statusCode);
    next(err);
  }
};

module.exports = {
  getDashboard,
  getUsersProgress,
  getAllUsers, getPendingUsers, verifyUser, updateUser,
  deleteUser, bulkDeleteUsers,
  getUserSubmissions,
  assignProjectToUser,
  unassignProjectFromUser,
  getProjectAssignees,
  getUserProfile,
  getAssignedProjectIdsByUser,
  createProject, getAllProjects, getProjectById, updateProject, deleteProject,
  createTask, uploadTasksImport, getTasksByProject, getTaskById, updateTask, deleteTask, deleteTasksBulk,
  getTaskSubmissions,
  getSubmissionsByProject,
  streamSubmissionAudio,
  deleteSubmission,
  addAdminCommentToFlag,
  exportResults,
  exportProjectResults,
  exportUserResults,
};
