/**
 * Danger-zone database reset. Three scopes, least to most destructive:
 *
 *   "tasks"        - deletes only tasks, submissions and Cloudinary audio.
 *                    Users, projects, assignments AND the lifetime progress
 *                    ledger all stay.
 *   "retain-users" - the above, and also clears the progress ledger. Users and
 *                    projects (with their assignments) still stay.
 *   "full"         - clean slate: also deletes every non-admin user, every
 *                    project and assignment; retained users lose their dangling
 *                    dedicatedProjectId.
 *
 * Every scope removes all tasks/submissions, purges every Cloudinary audio
 * under bolo/audio/, and resets the backup handshake + taskId counter.
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

const SCOPES = ["tasks", "retain-users", "full"];

const runReset = async ({ scope, adminId }) => {
  if (!SCOPES.includes(scope)) {
    const err = new Error("scope must be 'tasks', 'retain-users' or 'full'.");
    err.statusCode = 400;
    throw err;
  }

  const keepUsers = scope !== "full";
  const keepProjects = scope !== "full";
  const keepLedger = scope === "tasks";

  lock.acquire("reset");
  try {
    let usersDeleted = 0;
    if (!keepUsers) {
      const r = await User.deleteMany({ role: { $ne: "admin" } });
      usersDeleted = r.deletedCount || 0;
    }

    const [subs, tasks] = await Promise.all([
      TaskSubmission.deleteMany({}),
      Task.deleteMany({}),
    ]);

    let progressRowsDeleted = 0;
    if (!keepLedger) {
      const l = await UserProgress.deleteMany({});
      progressRowsDeleted = l.deletedCount || 0;
    }

    await Counter.deleteMany({});
    await BackupState.deleteMany({});

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
      progressRowsDeleted,
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
