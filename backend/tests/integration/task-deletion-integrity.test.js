import { beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import adminDao from "../../modules/admin/dao/admin.dao.js";
import userDao from "../../modules/user/dao/user.dao.js";
import { Project, ProjectAssignment, Task, TaskSubmission } from "../helpers/models.js";
import { createAdmin, createUser } from "../factories/user.factory.js";
import { createProject } from "../factories/project.factory.js";
import { createTask } from "../factories/task.factory.js";

/**
 * Regression coverage for three related bugs fixed in a row on this codebase:
 * task deletion used to cascade to submissions/audio, and the pending-count
 * math on both the admin and annotator sides assumed a submission always
 * pointed at a task that still existed. Deleting a task (then replacing it)
 * broke that assumption and either deflated or inflated "pending" everywhere
 * it was read.
 */

let admin;
let annotator;
let project;

beforeEach(async () => {
  admin = await createAdmin();
  annotator = await createUser();
  project = await createProject({ createdBy: admin._id });
  await ProjectAssignment.create({ projectId: project._id, userId: annotator._id, assignedBy: admin._id });
});

describe("admin.dao.deleteTask", () => {
  it("removes the task but keeps its submission and audio", async () => {
    const task = await createTask({ projectId: project._id });
    await TaskSubmission.create({
      taskId: task._id,
      projectId: project._id,
      userId: annotator._id,
      status: "completed",
      audio: { publicId: "bolo/audio/keep-me", url: "https://cdn.test/keep-me.wav" },
    });

    const { task: deleted } = await adminDao.deleteTask(task._id);

    expect(deleted._id.toString()).toBe(task._id.toString());
    expect(await Task.findById(task._id)).toBeNull();

    const survivingSubmission = await TaskSubmission.findOne({ taskId: task._id });
    expect(survivingSubmission).not.toBeNull();
    expect(survivingSubmission.status).toBe("completed");
    expect(survivingSubmission.audio.publicId).toBe("bolo/audio/keep-me");
  });

  it("pulls the deleted task's id off the project's tasks array", async () => {
    const task = await createTask({ projectId: project._id });
    await Project.findByIdAndUpdate(project._id, { $push: { tasks: task._id } });

    await adminDao.deleteTask(task._id);

    const reloaded = await Project.findById(project._id).lean();
    expect(reloaded.tasks.map(String)).not.toContain(task._id.toString());
  });

  it("returns a null task and does nothing for an id that does not exist", async () => {
    const { task } = await adminDao.deleteTask(new mongoose.Types.ObjectId());

    expect(task).toBeNull();
  });

  it("refuses to delete an already-archived task", async () => {
    const task = await createTask({ projectId: project._id, archivedAt: new Date() });

    const { task: deleted } = await adminDao.deleteTask(task._id);

    expect(deleted).toBeNull();
    expect(await Task.findById(task._id)).not.toBeNull();
  });
});

describe("admin.dao.deleteTasksBulk", () => {
  it("keeps submissions for an explicit list of deleted task ids", async () => {
    const taskA = await createTask({ projectId: project._id });
    const taskB = await createTask({ projectId: project._id });
    await TaskSubmission.create([
      { taskId: taskA._id, projectId: project._id, userId: annotator._id, status: "completed" },
      { taskId: taskB._id, projectId: project._id, userId: annotator._id, status: "discarded" },
    ]);

    const { deletedCount } = await adminDao.deleteTasksBulk(project._id, { ids: [taskA._id, taskB._id] });

    expect(deletedCount).toBe(2);
    expect(await Task.countDocuments({ projectId: project._id })).toBe(0);
    expect(await TaskSubmission.countDocuments({ projectId: project._id })).toBe(2);
  });

  it("keeps submissions when every task in the project is deleted via all:true", async () => {
    const task = await createTask({ projectId: project._id });
    await TaskSubmission.create({
      taskId: task._id,
      projectId: project._id,
      userId: annotator._id,
      status: "completed",
    });

    const { deletedCount } = await adminDao.deleteTasksBulk(project._id, { all: true });

    expect(deletedCount).toBe(1);
    expect(await Task.countDocuments({ projectId: project._id })).toBe(0);
    expect(await TaskSubmission.countDocuments({ projectId: project._id })).toBe(1);
  });

  it("excludes archived tasks from all:true", async () => {
    const live = await createTask({ projectId: project._id });
    const archived = await createTask({ projectId: project._id, archivedAt: new Date() });

    const { deletedCount } = await adminDao.deleteTasksBulk(project._id, { all: true });

    expect(deletedCount).toBe(1);
    expect(await Task.findById(live._id)).toBeNull();
    expect(await Task.findById(archived._id)).not.toBeNull();
  });
});

/**
 * The scenario that produced the reported bug: a task is finished, then
 * deleted, then a new untouched task takes its place in the same project.
 * Pending must reflect the one current untouched task - not be deflated by
 * the orphaned submission the deleted task left behind.
 */
describe("pending counts after a task is deleted and replaced", () => {
  let finishedTask;

  beforeEach(async () => {
    finishedTask = await createTask({ projectId: project._id });
    await TaskSubmission.create({
      taskId: finishedTask._id,
      projectId: project._id,
      userId: annotator._id,
      status: "completed",
    });
    await adminDao.deleteTask(finishedTask._id);
    await createTask({ projectId: project._id }); // the untouched replacement
  });

  it("admin.dao.getPerUserProgress reports the replacement task as pending, not zero", async () => {
    const rows = await adminDao.getPerUserProgress();
    const row = rows.find((r) => r._id.toString() === annotator._id.toString());

    expect(row.lifetime.pending).toBe(1);
    expect(row.today.pending).toBe(1);
  });

  it("user.dao.getProjectsForUser reports one pending task, not a negative or zero count", async () => {
    const projects = await userDao.getProjectsForUser(annotator._id);
    const stats = projects.find((p) => p._id.toString() === project._id.toString()).stats;

    expect(stats.total).toBe(1);
    expect(stats.completed).toBe(0);
    expect(stats.pending).toBe(1);
  });

  it("user.dao.getProjectTaskCountsForUser reports the same live pending count for the filter chips", async () => {
    const counts = await userDao.getProjectTaskCountsForUser(annotator._id, project._id);

    expect(counts.total).toBe(1);
    expect(counts.byStatus.pending).toBe(1);
    expect(counts.byStatus.completed).toBe(0);
  });

  it("the orphaned submission from the deleted task still exists for lifetime stats", async () => {
    const orphan = await TaskSubmission.findOne({ taskId: finishedTask._id });

    expect(orphan).not.toBeNull();
    expect(orphan.status).toBe("completed");
  });
});

/**
 * Same orphaned-submission scenario, different symptom: the lifetime
 * `completed` count includes submissions whose task was deleted, but the
 * percentage's denominator is the CURRENT task set - so an annotator who had
 * finished everything could read above 100%.
 */
describe("progressPercent after finished tasks are deleted", () => {
  const rowFor = async () => {
    const rows = await adminDao.getPerUserProgress();
    return rows.find((r) => r._id.toString() === annotator._id.toString());
  };

  it("never exceeds 100% when completed work on deleted tasks outnumbers the live tasks", async () => {
    const kept = await createTask({ projectId: project._id });
    const deleted = await createTask({ projectId: project._id });
    await TaskSubmission.create([
      { taskId: kept._id, projectId: project._id, userId: annotator._id, status: "completed" },
      { taskId: deleted._id, projectId: project._id, userId: annotator._id, status: "completed" },
    ]);
    await adminDao.deleteTask(deleted._id);

    const row = await rowFor();

    // 2 completed lifetime vs 1 live task used to give 200%.
    expect(row.lifetime.completed).toBe(2);
    expect(row.lifetime.assigned).toBe(1);
    expect(row.lifetime.progressPercent).toBe(100);
    expect(row.today.progressPercent).toBe(100);
  });

  it("measures only the live task set, ignoring work on deleted tasks", async () => {
    const doneKept = await createTask({ projectId: project._id });
    await createTask({ projectId: project._id }); // untouched
    const deleted = await createTask({ projectId: project._id });
    await TaskSubmission.create([
      { taskId: doneKept._id, projectId: project._id, userId: annotator._id, status: "completed" },
      { taskId: deleted._id, projectId: project._id, userId: annotator._id, status: "completed" },
    ]);
    await adminDao.deleteTask(deleted._id);

    const row = await rowFor();

    // 1 of the 2 live tasks is done. Counting the deleted one would give 100%.
    expect(row.lifetime.progressPercent).toBe(50);
    expect(row.lifetime.pending).toBe(1);
  });

  it("still counts discarded live tasks as done", async () => {
    const completed = await createTask({ projectId: project._id });
    const discarded = await createTask({ projectId: project._id });
    await TaskSubmission.create([
      { taskId: completed._id, projectId: project._id, userId: annotator._id, status: "completed" },
      { taskId: discarded._id, projectId: project._id, userId: annotator._id, status: "discarded" },
    ]);

    const row = await rowFor();

    expect(row.lifetime.progressPercent).toBe(100);
  });
});
