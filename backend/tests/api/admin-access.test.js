import { beforeEach, describe, expect, it } from "vitest";
import { buildTestApi } from "../helpers/api.js";
import { asAdmin, asUser, bearer, forgedToken } from "../helpers/auth.js";
import { createProject } from "../factories/project.factory.js";
import { createTask } from "../factories/task.factory.js";

const api = buildTestApi();

// Every /api/admin route sits behind the same two middlewares, so the guard is
// tested once on a representative route rather than once per endpoint.
describe("GET /api/admin/projects access control", () => {
  it("refuses a caller with no token", async () => {
    const response = await api.get("/api/admin/projects");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("refuses a token signed with the wrong secret", async () => {
    const { user } = await asUser();

    const response = await api.get("/api/admin/projects").set(bearer(forgedToken(user)));

    // The forged token's role claim says "admin"; the signature check has to
    // reject it before that claim is ever read.
    expect(response.status).toBe(401);
  });

  it("refuses an authenticated annotator", async () => {
    const { headers } = await asUser();

    const response = await api.get("/api/admin/projects").set(headers);

    expect(response.status).toBe(403);
  });

  it("returns the projects to an admin", async () => {
    const { user: admin, headers } = await asAdmin();
    await createProject({ createdBy: admin._id, name: "Mandarin Batch A" });

    const response = await api.get("/api/admin/projects").set(headers);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ name: "Mandarin Batch A" });
  });
});

describe("task fixtures", () => {
  let admin;

  beforeEach(async () => {
    admin = await asAdmin();
  });

  it("gives every task a generated TASK-NNNN identifier", async () => {
    const project = await createProject({ createdBy: admin.user._id });

    const task = await createTask({ projectId: project._id });

    expect(task.taskId).toMatch(/^TASK-\d{4}$/);
    expect(String(task.projectId)).toBe(String(project._id));
  });

  it("creates its own project when the caller does not supply one", async () => {
    const task = await createTask();

    expect(task.projectId).toBeDefined();
  });
});
