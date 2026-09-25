const express = require("express");
const router = express.Router();
const ctrl = require("./controllers/admin.controller");
const { authenticate, requireRole } = require("../../middlewares/auth");
const validate = require("../../middlewares/validate");
const { validateObjectId, validatePagination } = require("../../validators/common.validator");
const taskImportUpload = require("./services/taskImport.service");
const {
  createProjectValidator,
  updateProjectValidator,
  createTaskValidator,
  updateTaskValidator,
  updateUserValidator,
} = require("./validators/admin.validator");

// All admin routes require authentication + admin role
router.use(authenticate, requireRole("admin"));

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get("/dashboard", ctrl.getDashboard);
router.get("/users/progress", ctrl.getUsersProgress);

// ─── Backup & cleanup ────────────────────────────────────────────────────────
// GET  /backup         - streams a .zip of the finished set (completed/discarded
//                        tasks + audio + progress). Stamps lastBackupAt on a
//                        clean delivery, kept only for historical display -
//                        not required before /cleanup. Not linked from the
//                        dashboard (slow zip-download UX); still reachable
//                        directly for anyone who wants a full archive copy.
// GET  /backup/status  - card state: last backup/cleanup, whether cleanup is
//                        allowed, and how much it would remove.
// POST /cleanup        - archives the finished set (hides it from annotators;
//                        tasks/submissions/progress are kept) and purges its
//                        Cloudinary audio. No precondition on having backed
//                        up first - that's the admin's own responsibility.
router.get("/backup", ctrl.downloadBackup);
router.get("/backup/status", ctrl.getBackupStatus);
router.post("/cleanup", ctrl.runCleanup);

// ─── Danger zone ─────────────────────────────────────────────────────────────
// POST /reset { scope: "tasks" | "retain-users" | "full", confirm: "RESET" }
// Every scope removes all tasks, submissions and audio. "tasks" keeps
// everything else incl. progress history; "retain-users" also clears progress
// but keeps users + projects; "full" also wipes non-admin users + projects.
// Irreversible, no backup.
router.post("/reset", ctrl.resetDatabase);

// ─── Result export (partial results, no completion gate) ─────────────────────
router.get("/export", ctrl.exportResults);
router.get("/projects/:projectId/export", [validateObjectId("projectId"), validate], ctrl.exportProjectResults);
router.get("/users/:id/export", [validateObjectId("id"), validate], ctrl.exportUserResults);

// ─── Users ────────────────────────────────────────────────────────────────────
router.get("/users", ctrl.getAllUsers);
router.get("/users/pending", ctrl.getPendingUsers);
router.get("/users/:id/submissions", [validateObjectId("id"), validate], ctrl.getUserSubmissions);
router.patch("/users/:id/verify", [validateObjectId("id"), validate], ctrl.verifyUser);
router.patch("/users/:id", [validateObjectId("id"), ...updateUserValidator, validate], ctrl.updateUser);
// Soft delete is permanent - `DELETE /users/:id` sets deletedAt and the
// account stays inactive forever. There is no restore endpoint; the deleted
// user's email/phone/username become free for a fresh sign-up.
router.delete("/users/:id", [validateObjectId("id"), validate], ctrl.deleteUser);
router.post("/users/bulk-delete", ctrl.bulkDeleteUsers);
// POST /users/:id/reset { scope: "tasks" | "progress", confirm: "RESET" }
// Per-user danger zone, scoped to just this annotator's dedicated project.
// "tasks" wipes tasks/submissions/audio and keeps their progress ledger;
// "progress" also clears that ledger. Irreversible, no backup.
router.post("/users/:id/reset", [validateObjectId("id"), validate], ctrl.resetUserData);
router.patch(
  "/projects/:projectId/assign/:userId",
  [validateObjectId("projectId"), validateObjectId("userId"), validate],
  ctrl.assignProjectToUser
);
router.delete(
  "/projects/:projectId/assign/:userId",
  [validateObjectId("projectId"), validateObjectId("userId"), validate],
  ctrl.unassignProjectFromUser
);
router.get(
  "/users/:userId/assigned-projects",
  [validateObjectId("userId"), validate],
  ctrl.getAssignedProjectIdsByUser
);

// ─── Projects ─────────────────────────────────────────────────────────────────
router.post("/projects", createProjectValidator, validate, ctrl.createProject);
router.get("/projects", ctrl.getAllProjects);
router.get("/projects/:id", [validateObjectId("id"), validate], ctrl.getProjectById);
router.patch("/projects/:id", [validateObjectId("id"), ...updateProjectValidator, validate], ctrl.updateProject);
router.delete("/projects/:id", [validateObjectId("id"), validate], ctrl.deleteProject);
// POST /projects/:projectId/reset { scope: "tasks" | "progress", confirm: "RESET" }
// Per-project danger zone. "tasks" wipes tasks/submissions/audio and keeps
// every assignee's progress ledger; "progress" also clears it - for every
// assignee, not just one. Irreversible, no backup.
router.post(
  "/projects/:projectId/reset",
  [validateObjectId("projectId"), validate],
  ctrl.resetProjectData
);

// ─── Tasks ────────────────────────────────────────────────────────────────────
router.post("/projects/:projectId/tasks", [validateObjectId("projectId"), ...createTaskValidator, validate], ctrl.createTask);
router.post(
  "/projects/:projectId/tasks/upload",
  [validateObjectId("projectId"), validate],
  taskImportUpload.single("file"),
  ctrl.uploadTasksImport
);
// GET /projects/:projectId/tasks?page&limit&search - paginated
router.get(
  "/projects/:projectId/tasks",
  [validateObjectId("projectId"), ...validatePagination, validate],
  ctrl.getTasksByProject
);
router.get("/tasks/:id", [validateObjectId("id"), validate], ctrl.getTaskById);
router.patch("/tasks/:id", [validateObjectId("id"), ...updateTaskValidator, validate], ctrl.updateTask);
router.delete("/tasks/:id", [validateObjectId("id"), validate], ctrl.deleteTask);
router.post(
  "/projects/:projectId/tasks/bulk-delete",
  [validateObjectId("projectId"), validate],
  ctrl.deleteTasksBulk
);
router.get(
  "/projects/:projectId/assignees",
  [validateObjectId("projectId"), validate],
  ctrl.getProjectAssignees
);
router.get(
  "/projects/:projectId/submissions",
  [validateObjectId("projectId"), ...validatePagination, validate],
  ctrl.getSubmissionsByProject
);
router.get(
  "/users/:id/profile",
  [validateObjectId("id"), validate],
  ctrl.getUserProfile
);

// ─── Admin view user submissions ─────────────────────────────────────────────
router.get("/tasks/:id/submissions", [validateObjectId("id"), validate], ctrl.getTaskSubmissions);
router.get("/submissions/:id/audio", [validateObjectId("id"), validate], ctrl.streamSubmissionAudio);
router.delete("/submissions/:id", [validateObjectId("id"), validate], ctrl.deleteSubmission);

module.exports = router;
