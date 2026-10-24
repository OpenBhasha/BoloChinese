import { beforeEach, describe, expect, it } from "vitest";
import adminDao from "../../modules/admin/dao/admin.dao.js";
import userDao from "../../modules/user/dao/user.dao.js";
import { ProjectAssignment, Task, TaskSubmission } from "../helpers/models.js";
import { createAdmin, createUser } from "../factories/user.factory.js";
import { createProject } from "../factories/project.factory.js";
import { createTask } from "../factories/task.factory.js";

/**
 * Regression coverage for "Project finished" showing while tasks were still
 * pending. The server compared every terminal submission the annotator had
 * ever made against only the tasks still visible, so work on tasks that
 * cleanup had archived (or an admin had deleted) pushed the count past the
 * total and ended the project early.
 */

let admin;
let annotator;
let project;

const submit = (task, status = "completed") =>
  TaskSubmission.create({
    taskId: task._id,
    projectId: project._id,
    userId: annotator._id,
    status,
    audio: { publicId: `bolo/audio/${task._id}`, url: `https://cdn.test/${task._id}.wav` },
  });

const archive = (tasks) =>
  Task.updateMany({ _id: { $in: tasks.map((t) => t._id) } }, { $set: { archivedAt: new Date() } });

const createTasks = async (count) => {
  const tasks = [];
  // Sequential on purpose: nav ordering is by (createdAt, _id).
  for (let i = 0; i < count; i += 1) tasks.push(await createTask({ projectId: project._id }));
  return tasks;
};

beforeEach(async () => {
  admin = await createAdmin();
  annotator = await createUser();
  project = await createProject({ createdBy: admin._id });
  await ProjectAssignment.create({ projectId: project._id, userId: annotator._id, assignedBy: admin._id });
});

describe("user.dao.getTaskNavForUser - projectFinished", () => {
  it("is not finished after cleanup archives completed tasks while others are still pending", async () => {
    const tasks = await createTasks(10);
    const finished = tasks.slice(0, 6);
    for (const task of finished) await submit(task);
    await archive(finished);

    const nav = await userDao.getTaskNavForUser(annotator._id, project._id, tasks[6]);

    expect(nav.total).toBe(4);
    expect(nav.completedCount).toBe(0);
    expect(nav.projectFinished).toBe(false);
  });

  it("ignores submissions whose task was deleted", async () => {
    const tasks = await createTasks(4);
    await submit(tasks[0]);
    await submit(tasks[1]);
    await adminDao.deleteTask(tasks[1]._id);

    const nav = await userDao.getTaskNavForUser(annotator._id, project._id, tasks[2]);

    expect(nav.total).toBe(3);
    expect(nav.completedCount).toBe(1);
    expect(nav.projectFinished).toBe(false);
  });

  it("is finished once every visible task is completed or discarded", async () => {
    const tasks = await createTasks(5);
    await submit(tasks[0]);
    await archive([tasks[0]]);
    await submit(tasks[1]);
    await submit(tasks[2], "discarded");
    await submit(tasks[3]);
    await submit(tasks[4]);

    const nav = await userDao.getTaskNavForUser(annotator._id, project._id, tasks[4]);

    expect(nav.total).toBe(4);
    expect(nav.completedCount).toBe(4);
    expect(nav.projectFinished).toBe(true);
  });

  it("is not finished when the project has no visible tasks at all", async () => {
    const [only] = await createTasks(1);
    await submit(only);
    await archive([only]);

    const nav = await userDao.getTaskNavForUser(annotator._id, project._id, only);

    expect(nav.total).toBe(0);
    expect(nav.completedCount).toBe(0);
    expect(nav.projectFinished).toBe(false);
  });
});
