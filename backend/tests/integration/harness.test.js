import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import mongoose from "mongoose";
import { User } from "../helpers/models.js";
import { createUser } from "../factories/user.factory.js";
import { cloudinaryFake } from "../fakes/cloudinary.fake.js";

const requireCjs = createRequire(import.meta.url);

// Guards the harness itself. If these fail, treat every other integration
// result as suspect.
describe("test database wiring", () => {
  it("is connected to an ephemeral database of this worker's own", () => {
    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toMatch(/^bolo_test_w\d+$/);
  });

  it("builds the schema's indexes, not just the collection", async () => {
    const indexes = await User.collection.indexes();
    const emailIndex = indexes.find((index) => index.key?.email === 1);

    expect(emailIndex).toBeDefined();
    expect(emailIndex.unique).toBe(true);
    expect(emailIndex.partialFilterExpression).toEqual({ deletedAt: null });
  });

  it("starts each test with an empty database", async () => {
    expect(await User.countDocuments()).toBe(0);
    await createUser();
    expect(await User.countDocuments()).toBe(1);
  });

  it("does not see the user the previous test created", async () => {
    // Paired with the test above: if cleanup regressed, exactly one of the two
    // would fail depending on the order they ran in.
    expect(await User.countDocuments()).toBe(0);
  });
});

describe("third-party service wiring", () => {
  it("hands the application the Cloudinary fake rather than the real SDK", async () => {
    const cloudinary = requireCjs("../../services/cloudinary.service.js");

    const uploaded = await cloudinary.uploadAudio(Buffer.from("fake audio"), "TASK-0001", "user-1");

    expect(uploaded.url).toContain("res.cloudinary.test");
    expect(cloudinaryFake().has(uploaded.publicId)).toBe(true);
  });

  it("starts each test with an empty audio store", () => {
    expect(cloudinaryFake().size()).toBe(0);
  });
});
