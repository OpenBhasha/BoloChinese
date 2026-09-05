const dao = require("../dao/admin.dao");
const logger = require("../../../logging/logger");
const xlsx = require("xlsx");
const { parse: parseCsv } = require("csv-parse/sync");

const normalizeHeader = (value = "") => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const getCellValue = (row, aliases) => {
  const rowKeys = Object.keys(row || {});
  const matchedKey = rowKeys.find((key) => aliases.includes(normalizeHeader(key)));
  return matchedKey ? row[matchedKey] : undefined;
};

const toText = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

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

// ─── Dashboard ────────────────────────────────────────────────────────────────
const getDashboard = async () => dao.getDashboardStats();
const getUsersProgress = async () => dao.getPerUserProgress();

// ─── Users ────────────────────────────────────────────────────────────────────
const getAllUsers = async () => dao.getAllUsers();
const getPendingUsers = async () => dao.getPendingUsers();

const getUserSubmissions = async (userId) => {
  const user = await dao.getUserById(userId);
  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }
  return dao.getUserSubmissions(userId);
};

// After an admin approves an annotator, give them a dedicated project named
// after their username. Idempotent: a re-verify never creates a second project.
const provisionDedicatedProject = async (user, adminId) => {
  if (user.role !== "user") return null;
  if (user.dedicatedProjectId) return null;

  const projectName = user.username || `annotator-${String(user._id).slice(-6)}`;

  let project = await dao.getProjectByName(projectName);
  if (!project) {
    project = await dao.createProject({
      name: projectName,
      description: `Text Verification & Audio Data Collection for ${user.name}`,
      createdBy: adminId,
    });
  }

  await dao.assignProjectToUser(project._id, user._id, adminId);
  await dao.updateUser(user._id, { dedicatedProjectId: project._id });

  logger.info(`Dedicated project "${projectName}" provisioned for ${user.email} (project ${project._id}).`);
  return project;
};

const verifyUser = async (userId, adminId) => {
  const user = await dao.verifyUser(userId);
  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }
  logger.info(`Admin verified user: ${user.email}`);

  try {
    await provisionDedicatedProject(user, adminId);
  } catch (provisionErr) {
    // Approval must not fail just because project provisioning hit a snag.
    logger.error(`Could not provision dedicated project for ${user.email}: ${provisionErr.message}`);
  }

  return dao.getUserById(userId);
};

const updateUser = async (userId, payload) => {
  const user = await dao.getUserById(userId);
  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }

  const updateData = {};
  if (payload.name !== undefined) updateData.name = String(payload.name).trim();
  if (payload.email !== undefined) updateData.email = String(payload.email).trim().toLowerCase();
  if (payload.role !== undefined) updateData.role = payload.role;
  if (payload.isVerified !== undefined) updateData.isVerified = payload.isVerified;

  if (Object.keys(updateData).length === 0) {
    const err = new Error("At least one field is required to update user.");
    err.statusCode = 400;
    throw err;
  }

  if (updateData.email && updateData.email !== user.email) {
    const userWithEmail = await dao.getUserByEmail(updateData.email);
    if (userWithEmail && String(userWithEmail._id) !== String(userId)) {
      const err = new Error("Email is already in use.");
      err.statusCode = 409;
      throw err;
    }
  }

  const updatedUser = await dao.updateUser(userId, updateData);
  logger.info(`Admin updated user: ${updatedUser.email}`);
  return updatedUser;
};

const assignProjectToUser = async (projectId, userId, adminId) => {
  const [project, user] = await Promise.all([
    dao.getProjectById(projectId),
    dao.getUserById(userId),
  ]);

  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }

  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }

  if (user.role !== "user") {
    const err = new Error("Project can only be assigned to users with role 'user'.");
    err.statusCode = 400;
    throw err;
  }

  if (!user.isVerified) {
    const err = new Error("User must be verified before project assignment.");
    err.statusCode = 400;
    throw err;
  }

  await dao.assignProjectToUser(projectId, userId, adminId);
  logger.info(`Project ${projectId} assigned to user ${userId} by admin ${adminId}.`);

  return {
    projectId,
    userId,
    assignment: "created-or-updated",
  };
};

const getProjectAssignees = async (projectId) => {
  const project = await dao.getProjectById(projectId);
  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }
  return dao.getProjectAssignees(projectId);
};

const unassignProjectFromUser = async (projectId, userId, adminId) => {
  const [project, user] = await Promise.all([
    dao.getProjectById(projectId),
    dao.getUserById(userId),
  ]);

  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }

  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }

  const removed = await dao.unassignProjectFromUser(projectId, userId);
  if (!removed) {
    const err = new Error("Project is not assigned to this user.");
    err.statusCode = 404;
    throw err;
  }

  logger.info(`Project ${projectId} unassigned from user ${userId} by admin ${adminId}.`);

  return {
    projectId,
    userId,
    assignment: "removed",
  };
};

const getAssignedProjectIdsByUser = async (userId) => {
  const user = await dao.getUserById(userId);
  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }

  return dao.getAssignedProjectIdsByUser(userId);
};

const getTaskSubmissions = async (taskId) => {
  const task = await dao.getTaskById(taskId);
  if (!task) {
    const err = new Error("Task not found.");
    err.statusCode = 404;
    throw err;
  }

  return dao.getTaskSubmissions(taskId);
};

const getTaskSubmissionById = async (submissionId) => {
  const submission = await dao.getTaskSubmissionById(submissionId);
  if (!submission) {
    const err = new Error("Submission not found.");
    err.statusCode = 404;
    throw err;
  }

  return submission;
};

const deleteTaskSubmission = async (submissionId) => {
  const submission = await dao.getTaskSubmissionById(submissionId);
  if (!submission) {
    const err = new Error("Submission not found.");
    err.statusCode = 404;
    throw err;
  }

  if (submission.audio?.publicId) {
    try {
      const { deleteAudio } = require("../../../services/cloudinary.service");
      await deleteAudio(submission.audio.publicId);
    } catch (audioErr) {
      logger.warn(`Could not delete Cloudinary audio for submission ${submissionId}: ${audioErr.message}`);
    }
  }

  const deleted = await dao.deleteTaskSubmission(submissionId);
  logger.info(`Submission deleted: ${submissionId}`);
  return deleted;
};

const addAdminCommentToFlag = async (submissionId, adminComment, adminId) => {
  const submission = await dao.getTaskSubmissionById(submissionId);
  if (!submission) {
    const err = new Error("Submission not found.");
    err.statusCode = 404;
    throw err;
  }

  if (!submission.reportedIssue?.flagged) {
    const err = new Error("Submission is not flagged.");
    err.statusCode = 400;
    throw err;
  }

  const updated = await dao.addAdminCommentToFlag(submissionId, adminComment, adminId);
  logger.info(`Admin ${adminId} commented on submission ${submissionId}.`);
  return updated;
};

// ─── Projects ─────────────────────────────────────────────────────────────────
const createProject = async ({ name, description, adminId }) => {
  const project = await dao.createProject({ name, description, createdBy: adminId });
  logger.info(`Project created: ${project.name} (by admin ${adminId})`);
  return project;
};

const getAllProjects = async () => dao.getAllProjects();
const getProjectById = async (id) => {
  const project = await dao.getProjectById(id);
  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }
  if (Array.isArray(project.tasks)) {
    project.tasks = sortTasksByTaskId(project.tasks);
  }
  return project;
};

const updateProject = async (id, data) => {
  const project = await dao.updateProject(id, data);
  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }
  logger.info(`Project updated: ${id}`);
  return project;
};

const deleteProject = async (id) => {
  const project = await dao.deleteProject(id);
  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }
  logger.info(`Project deleted: ${id}`);
  return project;
};

// ─── Tasks ────────────────────────────────────────────────────────────────────
const createTask = async ({ projectId, dialogueId, chineseTranscript, pinyin, assignedTo }) => {
  // Ensure project exists
  const project = await dao.getProjectById(projectId);
  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }

  // Build task data
  const taskData = { projectId, dialogueId, chineseTranscript, pinyin };
  if (assignedTo) {
    taskData.assignedTo = assignedTo;
  }

  const task = await dao.createTask(taskData);
  await dao.addTaskToProject(projectId, task._id);
  logger.info(`Task created: ${task.taskId} under project ${projectId}`);
  return task;
};

const getTasksByProject = async (projectId) => {
  await getProjectById(projectId); // validates project exists
  return dao.getTasksByProject(projectId);
};

const getTaskById = async (id) => {
  const task = await dao.getTaskById(id);
  if (!task) {
    const err = new Error("Task not found.");
    err.statusCode = 404;
    throw err;
  }
  return task;
};

const updateTask = async (id, data) => {
  const task = await dao.updateTask(id, data);
  if (!task) {
    const err = new Error("Task not found.");
    err.statusCode = 404;
    throw err;
  }
  logger.info(`Task updated: ${id}`);
  return task;
};

const deleteTask = async (id) => {
  const task = await dao.getTaskById(id);
  if (!task) {
    const err = new Error("Task not found.");
    err.statusCode = 404;
    throw err;
  }
  await dao.removeTaskFromProject(task.projectId, id);
  await dao.deleteTask(id);
  logger.info(`Task deleted: ${id}`);
  return task;
};

const deleteTasksBulk = async (projectId, ids = []) => {
  if (!Array.isArray(ids) || !ids.length) {
    const err = new Error("Provide at least one task id to delete.");
    err.statusCode = 400;
    throw err;
  }
  const project = await dao.getProjectById(projectId);
  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }
  const { deletedCount } = await dao.deleteTasksBulk(projectId, ids);
  logger.info(`Bulk delete on project ${projectId}: removed ${deletedCount}/${ids.length} tasks`);
  return { deletedCount, requestedCount: ids.length };
};

const IMPORT_ROW_LIMIT = 25000;
const DIALOGUE_ID_ALIASES = ["dialogueid", "dialogue_id", "id"];
const CHINESE_TRANSCRIPT_ALIASES = ["chinesetranscript", "chinese_transcript", "transcript", "chinese"];
const PINYIN_ALIASES = ["pinyin"];

const parseXlsxRows = (fileBuffer) => {
  let workbook;
  try {
    workbook = xlsx.read(fileBuffer, { type: "buffer" });
  } catch {
    const err = new Error("Invalid Excel file. Please upload a valid .xlsx or .xls file.");
    err.statusCode = 400;
    throw err;
  }

  const firstSheetName = workbook.SheetNames?.[0];
  if (!firstSheetName) {
    const err = new Error("Excel file is empty.");
    err.statusCode = 400;
    throw err;
  }

  const sheet = workbook.Sheets[firstSheetName];
  return xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
};

const parseCsvRows = (fileBuffer) => {
  try {
    return parseCsv(fileBuffer, { columns: true, skip_empty_lines: true, bom: true });
  } catch {
    const err = new Error("Invalid CSV file. Please check the file formatting.");
    err.statusCode = 400;
    throw err;
  }
};

const createTasksFromImport = async (projectId, fileBuffer, fileExtension) => {
  const project = await dao.getProjectById(projectId);
  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }

  const rows = fileExtension === ".csv" ? parseCsvRows(fileBuffer) : parseXlsxRows(fileBuffer);

  if (!rows.length) {
    const err = new Error("No rows found in the uploaded file.");
    err.statusCode = 400;
    throw err;
  }

  if (rows.length > IMPORT_ROW_LIMIT) {
    const err = new Error(`Maximum ${IMPORT_ROW_LIMIT} tasks can be uploaded at once.`);
    err.statusCode = 400;
    throw err;
  }

  const rowErrors = [];
  const validDocs = []; // { rowNumber, doc: { projectId, dialogueId, chineseTranscript, pinyin } }
  const seenDialogueIds = new Set();

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1

    const dialogueId = toText(getCellValue(row, DIALOGUE_ID_ALIASES));
    const chineseTranscript = toText(getCellValue(row, CHINESE_TRANSCRIPT_ALIASES));
    const pinyin = toText(getCellValue(row, PINYIN_ALIASES));

    if (!dialogueId || !chineseTranscript || !pinyin) {
      rowErrors.push({ row: rowNumber, message: "Dialogue ID, Chinese Transcript, and Pinyin are all required." });
      return;
    }

    if (chineseTranscript.length > 20000) {
      rowErrors.push({ row: rowNumber, message: "Chinese Transcript must be at most 20000 characters." });
      return;
    }

    if (pinyin.length > 20000) {
      rowErrors.push({ row: rowNumber, message: "Pinyin must be at most 20000 characters." });
      return;
    }

    if (seenDialogueIds.has(dialogueId)) {
      rowErrors.push({ row: rowNumber, message: `Duplicate Dialogue ID "${dialogueId}" within this file.` });
      return;
    }
    seenDialogueIds.add(dialogueId);

    validDocs.push({ rowNumber, doc: { projectId, dialogueId, chineseTranscript, pinyin } });
  });

  // Catch duplicates against already-imported rows (e.g. a re-import of the same file).
  if (validDocs.length) {
    const existingIds = new Set(await dao.getExistingDialogueIds(projectId, validDocs.map((v) => v.doc.dialogueId)));
    for (let i = validDocs.length - 1; i >= 0; i -= 1) {
      if (existingIds.has(validDocs[i].doc.dialogueId)) {
        rowErrors.push({ row: validDocs[i].rowNumber, message: `Dialogue ID "${validDocs[i].doc.dialogueId}" already exists in this project.` });
        validDocs.splice(i, 1);
      }
    }
  }

  let createdCount = 0;
  let createdTaskIds = [];
  if (validDocs.length) {
    const result = await dao.bulkCreateTasks(validDocs.map((v) => v.doc));
    createdCount = result.insertedCount;
    createdTaskIds = result.insertedIds;
    result.writeErrors.forEach((we) => {
      const rowNumber = validDocs[we.index]?.rowNumber ?? null;
      rowErrors.push({ row: rowNumber, message: we.message });
    });
  }

  if (createdTaskIds.length) {
    await dao.addTasksToProject(projectId, createdTaskIds);
  }

  logger.info(
    `Bulk task import completed | project: ${projectId} | created: ${createdCount} | failed: ${rowErrors.length}`
  );

  return {
    createdCount,
    failedCount: rowErrors.length,
    totalRows: rows.length,
    errors: rowErrors.slice(0, 50),
  };
};

// ─── Result export (partial results allowed, no completion gate) ──────────────
const EXPORT_COLUMNS = [
  // Primary columns (annotator payload)
  { key: "taskId", header: "Task ID" },
  { key: "dialogueId", header: "Dialogue ID" },
  { key: "chineseTranscript", header: "Original Chinese" },
  { key: "pinyin", header: "Original Pinyin" },
  { key: "finalChinese", header: "Final Chinese" },
  { key: "finalPinyin", header: "Final Pinyin" },
  { key: "status", header: "Status" },
  { key: "audioUrl", header: "Audio URL" },
  { key: "audioDurationSeconds", header: "Audio Duration (s)" },
  { key: "timeSpentSeconds", header: "Time Spent (s)" },
  { key: "timeSpentHms", header: "Time Spent (h:mm:ss)" },
  // Annotator + project attribution
  { key: "project", header: "Project" },
  { key: "user", header: "Annotator" },
  { key: "userUsername", header: "Annotator Username" },
  { key: "userEmail", header: "Annotator Email" },
  // Workflow flags
  { key: "pinyinVerified", header: "Text Verified" },
  { key: "isCorrected", header: "Edited" },
  { key: "editCharCount", header: "Edited Chars" },
  { key: "discarded", header: "Discarded" },
  { key: "erroneous", header: "Erroneous" },
  { key: "erroneousReason", header: "Erroneous Reason" },
  // Audio technicals
  { key: "audioPublicId", header: "Audio Public ID" },
  { key: "audioSampleRate", header: "Sample Rate" },
  { key: "audioBitDepth", header: "Bit Depth" },
  { key: "audioSizeBytes", header: "Audio Size (bytes)" },
  { key: "audioUploadedAt", header: "Audio Uploaded At" },
  // Timestamps
  { key: "taskCreatedAt", header: "Task Created At" },
  { key: "updatedAt", header: "Last Updated" },
];

const formatHms = (totalSeconds) => {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};

const toExportRow = (submission) => {
  const task = submission.taskId || {};
  const correctedChinese = submission.correctedChineseTranscript || "";
  const correctedPinyin = submission.correctedPinyin || "";
  const timeSpentSeconds = Math.round((submission.timeSpentMs || 0) / 1000);
  return {
    taskId: task.taskId || "",
    dialogueId: task.dialogueId || "",
    chineseTranscript: task.chineseTranscript || "",
    pinyin: task.pinyin || "",
    finalChinese: correctedChinese || task.chineseTranscript || "",
    finalPinyin: correctedPinyin || task.pinyin || "",
    status: submission.status || "",
    audioUrl: submission.audio?.url || "",
    audioDurationSeconds: submission.audio?.durationSeconds || 0,
    timeSpentSeconds,
    timeSpentHms: formatHms(timeSpentSeconds),
    project: submission.projectId?.name || "",
    user: submission.userId?.name || "",
    userUsername: submission.userId?.username || "",
    userEmail: submission.userId?.email || "",
    pinyinVerified: submission.pinyinVerified === true ? "yes" : submission.pinyinVerified === false ? "no" : "",
    isCorrected: submission.isCorrected ? "yes" : "no",
    editCharCount: submission.editCharCount || 0,
    discarded: submission.discarded?.flagged ? "yes" : "no",
    erroneous: submission.erroneous?.flagged ? "yes" : "no",
    erroneousReason: submission.erroneous?.reason || "",
    audioPublicId: submission.audio?.publicId || "",
    audioSampleRate: submission.audio?.sampleRate || "",
    audioBitDepth: submission.audio?.bitDepth || "",
    audioSizeBytes: submission.audio?.fileSizeBytes || 0,
    audioUploadedAt: submission.audio?.uploadedAt ? new Date(submission.audio.uploadedAt).toISOString() : "",
    taskCreatedAt: task.createdAt ? new Date(task.createdAt).toISOString() : "",
    updatedAt: submission.updatedAt ? new Date(submission.updatedAt).toISOString() : "",
  };
};

const exportResults = async ({ projectId, userId } = {}) => {
  const { toCsv } = require("../../../services/csv");

  const filter = {};
  let scopeLabel = "all";

  if (projectId) {
    const project = await dao.getProjectById(projectId);
    if (!project) {
      const err = new Error("Project not found.");
      err.statusCode = 404;
      throw err;
    }
    filter.projectId = projectId;
    scopeLabel = (project.name || "project").replace(/[^a-z0-9_-]+/gi, "-");
  }

  if (userId) {
    const user = await dao.getUserById(userId);
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      throw err;
    }
    filter.userId = userId;
    scopeLabel = (user.username || user.name || "user").replace(/[^a-z0-9_-]+/gi, "-");
  }

  const submissions = await dao.getSubmissionsForExport(filter);
  const csv = toCsv(EXPORT_COLUMNS, submissions.map(toExportRow));
  const stamp = new Date().toISOString().slice(0, 10);

  logger.info(`Results exported | scope: ${scopeLabel} | rows: ${submissions.length}`);
  return { filename: `bolo-results-${scopeLabel}-${stamp}.csv`, csv, rowCount: submissions.length };
};

module.exports = {
  getDashboard,
  getUsersProgress,
  getAllUsers, getPendingUsers, verifyUser, updateUser,
  getUserSubmissions,
  assignProjectToUser,
  unassignProjectFromUser,
  getAssignedProjectIdsByUser,
  getProjectAssignees,
  getTaskSubmissions,
  getTaskSubmissionById,
  deleteTaskSubmission,
  addAdminCommentToFlag,
  exportResults,
  createProject, getAllProjects, getProjectById, updateProject, deleteProject,
  createTask, createTasksFromImport, getTasksByProject, getTaskById, updateTask, deleteTask, deleteTasksBulk,
};
