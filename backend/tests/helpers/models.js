// Models register themselves on the default connection as a side effect of
// being required, so index syncing and clearing need them all loaded - not
// just the ones the test at hand happens to touch.
import User from "../../modules/register/models/user.model.js";
import Project from "../../modules/admin/models/project.model.js";
import Task from "../../modules/admin/models/task.model.js";
import ProjectAssignment from "../../modules/admin/models/projectAssignment.model.js";
import TaskSubmission from "../../modules/admin/models/taskSubmission.model.js";
import UserProgress from "../../modules/admin/models/userProgress.model.js";
import BackupState from "../../modules/admin/models/backupState.model.js";
import Counter from "../../modules/admin/models/counter.model.js";
import Recording from "../../modules/recording/models/recording.model.js";

export const models = {
  User,
  Project,
  Task,
  ProjectAssignment,
  TaskSubmission,
  UserProgress,
  BackupState,
  Counter,
  Recording,
};

export {
  User,
  Project,
  Task,
  ProjectAssignment,
  TaskSubmission,
  UserProgress,
  BackupState,
  Counter,
  Recording,
};
