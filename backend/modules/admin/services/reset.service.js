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
 *
 * Also exports runUserReset() and runProjectReset() - the same idea narrowed
 * to one annotator's dedicated project, or to one project directly, for a
 * "give them a fresh batch" reset from the user or project page. See their
 * own doc comments below.
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
const { deleteAllAudio, deleteAudioBulk } = require("../../../services/cloudinary.service");
const lock = require("./backupLock");

const SCOPES = ["tasks", "retain-users", "full"];
const USER_SCOPES = ["tasks", "progress"];

// Best-effort Cloudinary cleanup - never blocks or fails the DB reset.
const purgeAudio = async (publicIds = []) => {
  if (!publicIds.length) return { deleted: 0, error: null };
  try {
    await deleteAudioBulk(publicIds);
    return { deleted: publicIds.length, error: null };
  } catch (err) {
    logger.warn(`reset: Cloudinary cleanup skipped for ${publicIds.length} file(s): ${err.message}`);
    return { deleted: 0, error: err.message };
  }
};

// Shared by runUserReset and runProjectReset: wipe one project's tasks,
// submissions and their Cloudinary audio. Ledger handling differs between the
// two callers (one user vs. every assignee), so that stays out of here.
const wipeProjectTasks = async (projectId) => {
  const audioPublicIds = await TaskSubmission.find({
    projectId,
    "audio.publicId": { $ne: null },
  }).distinct("audio.publicId");

  const [subs, tasks] = await Promise.all([
    TaskSubmission.deleteMany({ projectId }),
    Task.deleteMany({ projectId }),
  ]);
  await Project.findByIdAndUpdate(projectId, { $set: { tasks: [] } });

  const { deleted: audioDeleted, error: audioError } = await purgeAudio(audioPublicIds);

  return {
    tasksDeleted: tasks.deletedCount || 0,
    submissionsDeleted: subs.deletedCount || 0,
    audioDeleted,
    audioError,
  };
};

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

/**
 * Per-user danger-zone reset, scoped to just that annotator's dedicated
 * project - never touches any other user's tasks or a shared project other
 * annotators are also assigned to.
 *
 *   "tasks"    - deletes this user's tasks, submissions and Cloudinary audio.
 *                Their lifetime progress ledger stays untouched.
 *   "progress" - the above, and also clears their progress ledger rows.
 *
 * Unlike the site-wide reset, the taskId counter is NOT touched (it's shared
 * across every project - resetting it here would risk colliding with taskIds
 * already in use elsewhere), and BackupState is left alone (that's the
 * site-wide daily-cleanup handshake, unrelated to one user's manual reset).
 */
const runUserReset = async ({ userId, scope, adminId }) => {
  if (!USER_SCOPES.includes(scope)) {
    const err = new Error("scope must be 'tasks' or 'progress'.");
    err.statusCode = 400;
    throw err;
  }

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error("User not found.");
    err.statusCode = 404;
    throw err;
  }

  const projectId = user.dedicatedProjectId;
  if (!projectId) {
    const stats = {
      scope, userId: String(user._id), projectId: null,
      tasksDeleted: 0, submissionsDeleted: 0, progressRowsDeleted: 0, audioDeleted: 0, audioError: null,
    };
    logger.warn(`User reset skipped for ${user.email}: no dedicated project.`);
    return stats;
  }

  lock.acquire("user-reset");
  try {
    const wipe = await wipeProjectTasks(projectId);

    let progressRowsDeleted = 0;
    if (scope === "progress") {
      const led = await UserProgress.deleteMany({ userId });
      progressRowsDeleted = led.deletedCount || 0;
    }

    const stats = {
      scope,
      userId: String(user._id),
      projectId: String(projectId),
      ...wipe,
      progressRowsDeleted,
    };
    logger.warn(`USER RESET (${scope}) for ${user.email} by admin ${adminId} | ${JSON.stringify(stats)}`);
    return stats;
  } finally {
    lock.release();
  }
};

/**
 * Per-project danger-zone reset - the same idea as runUserReset, but keyed by
 * project instead of resolving one from a user. Useful for a shared project
 * (more than one assignee) as well as a dedicated one.
 *
 *   "tasks"    - deletes the project's tasks, submissions and Cloudinary
 *                audio. Every assignee's progress ledger stays untouched.
 *   "progress" - the above, and also clears the progress ledger for every
 *                user currently assigned to this project. On a shared
 *                project that's *all* of their history, not just this
 *                project's share of it (the ledger isn't broken down by
 *                project) - the caller should make that clear before firing.
 *
 * Same exceptions as runUserReset: the taskId counter and BackupState are
 * left alone.
 */
const runProjectReset = async ({ projectId, scope, adminId }) => {
  if (!USER_SCOPES.includes(scope)) {
    const err = new Error("scope must be 'tasks' or 'progress'.");
    err.statusCode = 400;
    throw err;
  }

  const project = await Project.findById(projectId);
  if (!project) {
    const err = new Error("Project not found.");
    err.statusCode = 404;
    throw err;
  }

  lock.acquire("project-reset");
  try {
    const wipe = await wipeProjectTasks(projectId);

    let progressRowsDeleted = 0;
    let usersAffected = 0;
    if (scope === "progress") {
      const assignedUserIds = await ProjectAssignment.find({ projectId }).distinct("userId");
      usersAffected = assignedUserIds.length;
      if (assignedUserIds.length) {
        const led = await UserProgress.deleteMany({ userId: { $in: assignedUserIds } });
        progressRowsDeleted = led.deletedCount || 0;
      }
    }

    const stats = {
      scope,
      projectId: String(project._id),
      ...wipe,
      progressRowsDeleted,
      usersAffected,
    };
    logger.warn(`PROJECT RESET (${scope}) for "${project.name}" by admin ${adminId} | ${JSON.stringify(stats)}`);
    return stats;
  } finally {
    lock.release();
  }
};

module.exports = { runReset, SCOPES, runUserReset, runProjectReset, USER_SCOPES };
