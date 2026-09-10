/**
 * Danger-zone database reset. Two scopes:
 *
 *   "full"         - wipe everything, keep only admin accounts.
 *   "retain-users" - wipe everything, keep every user account.
 *
 * Either way: all projects, tasks, submissions, assignments, the progress
 * ledger, the backup handshake state, and the taskId counter go, and every
 * Cloudinary audio under bolo/audio/ is purged. Retained users have their
 * dangling dedicatedProjectId cleared.
 *
 * This is irreversible and has no backup step - the caller (the dashboard)
 * gates it behind a typed confirmation.
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

  lock.acquire("reset");
  try {
    let usersDeleted = 0;
    if (scope === "full") {
      const r = await User.deleteMany({ role: { $ne: "admin" } });
      usersDeleted = r.deletedCount || 0;
    }

    const [subs, tasks, assigns, projects, ledger] = await Promise.all([
      TaskSubmission.deleteMany({}),
      Task.deleteMany({}),
      ProjectAssignment.deleteMany({}),
      Project.deleteMany({}),
      UserProgress.deleteMany({}),
    ]);
    await Counter.deleteMany({});
    await BackupState.deleteMany({});
    await User.updateMany(
      { dedicatedProjectId: { $ne: null } },
      { $set: { dedicatedProjectId: null } }
    );

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
      projectsDeleted: projects.deletedCount || 0,
      tasksDeleted: tasks.deletedCount || 0,
      submissionsDeleted: subs.deletedCount || 0,
      assignmentsDeleted: assigns.deletedCount || 0,
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
