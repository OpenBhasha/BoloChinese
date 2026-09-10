/**
 * Danger-zone database reset. Two scopes:
 *
 *   "full"         - clean slate: deletes every non-admin user, every project,
 *                    assignment, task, submission, and the progress ledger.
 *                    Retained users lose their dangling dedicatedProjectId.
 *   "retain-users" - keeps all user accounts AND all projects (with their
 *                    assignments) - only tasks, submissions, audio and the
 *                    progress ledger go, ready for a fresh daily batch.
 *
 * Either way: every task/submission is removed, every Cloudinary audio under
 * bolo/audio/ is purged, and the backup handshake + taskId counter are reset.
 *
 * Irreversible, no backup step - the caller (the dashboard) gates it behind a
 * typed confirmation.
 */
const User = require("../../register/models/user.model");
const Project = require("../models/project.model");
const Task = require("../models/task.model");
const ProjectAssignment = require("../models/projectAssignment.model");
const TaskSubmission = require("../models/taskSubmission.model");
const UserProgress = require("../models/userProgress.model");
const BackupState = require("../models/backupState.model");
const Counter = require("../models/counter.model");
const logger = require("../../../logging/logger");
const { deleteAllAudio } = require("../../../services/cloudinary.service");
const lock = require("./backupLock");

const SCOPES = ["full", "retain-users"];

const runReset = async ({ scope, adminId }) => {
  if (!SCOPES.includes(scope)) {
    const err = new Error("scope must be 'full' or 'retain-users'.");
    err.statusCode = 400;
    throw err;
  }

  const keepProjects = scope === "retain-users";

  lock.acquire("reset");
  try {
    let usersDeleted = 0;
    if (scope === "full") {
      const r = await User.deleteMany({ role: { $ne: "admin" } });
      usersDeleted = r.deletedCount || 0;
    }

    // Always gone.
    const [subs, tasks, ledger] = await Promise.all([
      TaskSubmission.deleteMany({}),
      Task.deleteMany({}),
      UserProgress.deleteMany({}),
    ]);
    await Counter.deleteMany({});
    await BackupState.deleteMany({});

    // Project structure: kept for "retain-users", wiped for "full".
    let projectsDeleted = 0;
    let assignmentsDeleted = 0;
    if (keepProjects) {
      // Tasks are gone, so drop the now-empty tasks[] pointer arrays.
      await Project.updateMany({ tasks: { $ne: [] } }, { $set: { tasks: [] } });
    } else {
      const [p, a] = await Promise.all([
        Project.deleteMany({}),
        ProjectAssignment.deleteMany({}),
      ]);
      projectsDeleted = p.deletedCount || 0;
      assignmentsDeleted = a.deletedCount || 0;
      await User.updateMany(
        { dedicatedProjectId: { $ne: null } },
        { $set: { dedicatedProjectId: null } }
      );
    }

    let audioDeleted = 0;
    let audioError = null;
    try {
      audioDeleted = await deleteAllAudio();
    } catch (err) {
      audioError = err.message;
      logger.warn(`reset: Cloudinary wipe skipped/failed: ${err.message}`);
    }

    const stats = {
      scope,
      usersDeleted,
      projectsDeleted,
      assignmentsDeleted,
      tasksDeleted: tasks.deletedCount || 0,
      submissionsDeleted: subs.deletedCount || 0,
      progressRowsDeleted: ledger.deletedCount || 0,
      audioDeleted,
      audioError,
    };
    logger.warn(`DATABASE RESET (${scope}) by admin ${adminId} | ${JSON.stringify(stats)}`);
    return stats;
  } finally {
    lock.release();
  }
};

module.exports = { runReset, SCOPES };
