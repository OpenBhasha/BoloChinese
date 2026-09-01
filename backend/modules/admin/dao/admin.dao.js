const User = require("../../register/models/user.model");
const Project = require("../models/project.model");
const Task = require("../models/task.model");
const ProjectAssignment = require("../models/projectAssignment.model");
const TaskSubmission = require("../models/taskSubmission.model");

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

// ─── Users ──────────────────────────────────────────────────────────────────

const getAllUsers = async () => {
  return User.find().select("-password").sort({ createdAt: -1 });
};

const getPendingUsers = async () => {
  return User.find({ isVerified: false }).select("-password").sort({ createdAt: -1 });
};

const verifyUser = async (userId) => {
  return User.findByIdAndUpdate(userId, { isVerified: true }, { new: true }).select("-password");
};

const updateUser = async (userId, data) => {
  return User.findByIdAndUpdate(userId, data, { new: true, runValidators: true }).select("-password");
};

const getUserById = async (userId) => {
  return User.findById(userId).select("-password");
};

const getUserByEmail = async (email) => {
  return User.findOne({ email: String(email).trim().toLowerCase() }).select("-password");
};

// ─── Projects ────────────────────────────────────────────────────────────────

const createProject = async (data) => {
  const project = new Project(data);
  return project.save();
};

const getAllProjects = async () => {
  return Project.find().populate("createdBy", "name email").sort({ createdAt: -1 });
};

const getProjectById = async (id) => {
  return Project.findById(id).populate("createdBy", "name email").populate("tasks");
};

const updateProject = async (id, data) => {
  return Project.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

const deleteProject = async (id) => {
  return Project.findByIdAndDelete(id);
};

// ─── Tasks ───────────────────────────────────────────────────────────────────

const createTask = async (data) => {
  const task = new Task(data);
  const savedTask = await task.save();
  return Task.findById(savedTask._id).populate("assignedTo", "name email");
};

const addTaskToProject = async (projectId, taskId) => {
  return Project.findByIdAndUpdate(projectId, { $push: { tasks: taskId } }, { new: true });
};

const addTasksToProject = async (projectId, taskIds) => {
  return Project.findByIdAndUpdate(projectId, { $push: { tasks: { $each: taskIds } } }, { new: true });
};

const getTasksByProject = async (projectId) => {
  const tasks = await Task.find({ projectId })
    .populate("assignedTo", "name email")
    .lean();

  return sortTasksByTaskId(tasks);
};

const getTaskById = async (id) => {
  return Task.findById(id).populate("assignedTo", "name email");
};

const updateTask = async (id, data) => {
  return Task.findByIdAndUpdate(id, data, { new: true, runValidators: true })
    .populate("assignedTo", "name email");
};

const deleteTask = async (id) => {
  return Task.findByIdAndDelete(id);
};

const removeTaskFromProject = async (projectId, taskId) => {
  return Project.findByIdAndUpdate(projectId, { $pull: { tasks: taskId } }, { new: true });
};

const assignProjectToUser = async (projectId, userId, adminId) => {
  return ProjectAssignment.findOneAndUpdate(
    { projectId, userId },
    { $set: { assignedBy: adminId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const unassignProjectFromUser = async (projectId, userId) => {
  return ProjectAssignment.findOneAndDelete({ projectId, userId });
};

const getAssignedProjectIdsByUser = async (userId) => {
  const assignments = await ProjectAssignment.find({ userId }).select("projectId").lean();
  return assignments.map((a) => a.projectId.toString());
};

const getTaskSubmissions = async (taskId) => {
  return TaskSubmission.find({ taskId })
    .populate("userId", "name email")
    .sort({ updatedAt: -1 });
};

const getTaskSubmissionById = async (submissionId) => {
  return TaskSubmission.findById(submissionId).populate("userId", "name email");
};

const deleteTaskSubmission = async (submissionId) => {
  return TaskSubmission.findByIdAndDelete(submissionId).populate("userId", "name email");
};

const addAdminCommentToFlag = async (submissionId, comment, adminId) => {
  return TaskSubmission.findByIdAndUpdate(
    submissionId,
    {
      $set: {
        "reportedIssue.adminComment": comment,
        "reportedIssue.adminCommentedAt": new Date(),
        "reportedIssue.adminCommentedBy": adminId,
      },
    },
    { new: true }
  ).populate("userId", "name email");
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

const getDashboardStats = async () => {
  const [totalUsers, pendingUsers, totalProjects, totalTasks, submissionsByStatus] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isVerified: false }),
    Project.countDocuments(),
    Task.countDocuments(),
    TaskSubmission.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const statusMap = {};
  submissionsByStatus.forEach((s) => { statusMap[s._id] = s.count; });
  const completed = statusMap["completed"] || 0;
  const corrected = statusMap["corrected"] || 0;
  const erroneous = statusMap["erroneous"] || 0;
  const requiresReview = statusMap["requires-review"] || 0;
  const inProgress = statusMap["in-progress"] || 0;
  const verified = statusMap["verified"] || 0;
  const submitted = completed + corrected + erroneous + requiresReview + inProgress + verified + (statusMap["recorded"] || 0) + (statusMap["skipped"] || 0);

  return {
    users: { total: totalUsers, pending: pendingUsers, verified: totalUsers - pendingUsers },
    projects: { total: totalProjects },
    tasks: {
      total: totalTasks,
      completed,
      corrected,
      erroneous,
      requiresReview,
      // Rough site-wide indicator only: distinct tasks vs. total per-user submission
      // records can diverge when a project has more than one assigned user. The
      // accurate per-user breakdown lives in getPerUserProgress().
      pending: Math.max(0, totalTasks - submitted),
    },
  };
};

module.exports = {
  getAllUsers, getPendingUsers, verifyUser, updateUser,
  getUserById, getUserByEmail,
  createProject, getAllProjects, getProjectById, updateProject, deleteProject,
  createTask, addTaskToProject, addTasksToProject, getTasksByProject, getTaskById, updateTask, deleteTask, removeTaskFromProject,
  assignProjectToUser,
  unassignProjectFromUser,
  getAssignedProjectIdsByUser,
  getTaskSubmissions,
  getTaskSubmissionById,
  deleteTaskSubmission,
  addAdminCommentToFlag,
  getDashboardStats,
};
