import { beforeEach, describe, expect, it } from "vitest";
import { buildTestApi } from "../helpers/api.js";
import { asAdmin, asUser, bearer } from "../helpers/auth.js";
import { createProject } from "../factories/project.factory.js";
import { createTask } from "../factories/task.factory.js";
import { buildWav } from "../helpers/wav.js";
import { ProjectAssignment } from "../helpers/models.js";
import { cloudinaryFake } from "../fakes/cloudinary.fake.js";

const api = buildTestApi();

const attachWav = (request, buffer, filename = "clip.wav") =>
  request.attach("audio", buffer, { filename, contentType: "audio/wav" });

let admin;
let user;
let project;
let task;

beforeEach(async () => {
  admin = await asAdmin();
  user = await asUser();
  project = await createProject({ createdBy: admin.user._id });
  task = await createTask({ projectId: project._id });
  await ProjectAssignment.create({ projectId: project._id, userId: user.user._id, assignedBy: admin.user._id });
});

describe("POST /api/user/tasks/:id/audio", () => {
  it("refuses a recording before the transcript has been verified or corrected", async () => {
    const response = await attachWav(
      api.post(`/api/user/tasks/${task._id}/audio`).set(user.headers),
      buildWav()
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/verify the text/i);
    expect(cloudinaryFake().size()).toBe(0);
  });

  it("accepts a conforming clip once the transcript is verified, and stores it via Cloudinary", async () => {
    await api.patch(`/api/user/tasks/${task._id}/verify-pinyin`).set(user.headers).send({ correct: true });

    const response = await attachWav(
      api.post(`/api/user/tasks/${task._id}/audio`).set(user.headers),
      buildWav({ durationSeconds: 2 })
    );

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("completed");
    expect(response.body.data.audio.publicId).toEqual(expect.any(String));
    expect(response.body.data.audio.sampleRate).toBe(16000);
    expect(cloudinaryFake().has(response.body.data.audio.publicId)).toBe(true);
  });

  it("rejects a clip recorded at the wrong sample rate, after verification", async () => {
    await api.patch(`/api/user/tasks/${task._id}/verify-pinyin`).set(user.headers).send({ correct: true });

    const response = await attachWav(
      api.post(`/api/user/tasks/${task._id}/audio`).set(user.headers),
      buildWav({ sampleRate: 44100 })
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/sample rate/i);
    expect(cloudinaryFake().size()).toBe(0);
  });

  it("deletes the old clip from Cloudinary when the annotator re-records", async () => {
    await api.patch(`/api/user/tasks/${task._id}/verify-pinyin`).set(user.headers).send({ correct: true });
    const first = await attachWav(api.post(`/api/user/tasks/${task._id}/audio`).set(user.headers), buildWav());
    const firstPublicId = first.body.data.audio.publicId;

    const second = await attachWav(
      api.post(`/api/user/tasks/${task._id}/audio`).set(user.headers),
      buildWav({ durationSeconds: 3 })
    );

    expect(second.status).toBe(200);
    expect(second.body.data.audio.publicId).not.toBe(firstPublicId);
    expect(cloudinaryFake().has(firstPublicId)).toBe(false);
    expect(cloudinaryFake().has(second.body.data.audio.publicId)).toBe(true);
  });

  it("refuses a recording for a task that was discarded, until it is reconsidered", async () => {
    await api.patch(`/api/user/tasks/${task._id}/verify-pinyin`).set(user.headers).send({ correct: true });
    await api.post(`/api/user/tasks/${task._id}/discard`).set(user.headers);

    const response = await attachWav(
      api.post(`/api/user/tasks/${task._id}/audio`).set(user.headers),
      buildWav()
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/discarded/i);
  });

  it("refuses a task that belongs to a project not assigned to the caller", async () => {
    const otherProject = await createProject({ createdBy: admin.user._id });
    const otherTask = await createTask({ projectId: otherProject._id });

    const response = await attachWav(
      api.post(`/api/user/tasks/${otherTask._id}/audio`).set(user.headers),
      buildWav()
    );

    expect(response.status).toBe(403);
  });

  it("refuses the request with no auth token at all", async () => {
    const response = await attachWav(api.post(`/api/user/tasks/${task._id}/audio`), buildWav());

    expect(response.status).toBe(401);
  });

  it("refuses an admin token - this route is annotator-only", async () => {
    const response = await attachWav(
      api.post(`/api/user/tasks/${task._id}/audio`).set(admin.headers),
      buildWav()
    );

    expect(response.status).toBe(403);
  });
});
