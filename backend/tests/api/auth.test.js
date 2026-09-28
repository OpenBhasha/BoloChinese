import { describe, expect, it } from "vitest";
import { buildTestApi } from "../helpers/api.js";
import { userAttrs } from "../factories/user.factory.js";
import { createUser } from "../factories/user.factory.js";
import { User } from "../helpers/models.js";

const api = buildTestApi();

describe("POST /api/auth/register", () => {
  it("registers a new annotator and never returns the password", async () => {
    const attrs = userAttrs();

    const response = await api.post("/api/auth/register").send(attrs);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: attrs.name,
      email: attrs.email.toLowerCase(),
      role: "user",
      isVerified: false,
    });
    expect(response.body.data.password).toBeUndefined();

    const stored = await User.findOne({ email: attrs.email.toLowerCase() }).select("+password");
    expect(stored.password).not.toBe(attrs.password);
  });

  it("ignores a client-supplied role and always registers as an annotator", async () => {
    const attrs = userAttrs();

    const response = await api.post("/api/auth/register").send({ ...attrs, role: "admin" });

    expect(response.status).toBe(201);
    expect(response.body.data.role).toBe("user");

    const stored = await User.findOne({ email: attrs.email.toLowerCase() });
    expect(stored.role).toBe("user");
  });

  it("rejects a duplicate email", async () => {
    const attrs = userAttrs();
    await api.post("/api/auth/register").send(attrs);

    const response = await api.post("/api/auth/register").send(userAttrs({ email: attrs.email }));

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });

  it("rejects a duplicate phone even when formatted differently", async () => {
    const attrs = userAttrs();
    await api.post("/api/auth/register").send(attrs);

    const response = await api
      .post("/api/auth/register")
      .send(userAttrs({ phone: attrs.phone.replace("+91", "+91 ") }));

    expect(response.status).toBe(409);
  });

  it("rejects an obviously placeholder name", async () => {
    const response = await api.post("/api/auth/register").send(userAttrs({ name: "Anonymous" }));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/placeholder/i);
  });

  it("rejects a password without an uppercase letter or a digit", async () => {
    const response = await api.post("/api/auth/register").send(userAttrs({ password: "lowercaseonly" }));

    expect(response.status).toBe(422);
    expect(response.body.errors.some((e) => e.field === "password")).toBe(true);
  });

  it("rejects a phone number that is not a real international number", async () => {
    const response = await api.post("/api/auth/register").send(userAttrs({ phone: "123" }));

    expect(response.status).toBe(422);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in a verified annotator and issues a usable token", async () => {
    const attrs = userAttrs();
    await createUser({ ...attrs, isVerified: true });

    const response = await api.post("/api/auth/login").send({ email: attrs.email, password: attrs.password });

    expect(response.status).toBe(200);
    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.user).toMatchObject({ email: attrs.email, role: "user" });
    expect(response.body.data.user.password).toBeUndefined();

    const authedResponse = await api
      .get("/api/user/me")
      .set("Authorization", `Bearer ${response.body.data.token}`);
    expect(authedResponse.status).toBe(200);
  });

  it("refuses a wrong password without saying which part was wrong", async () => {
    const attrs = userAttrs();
    await createUser({ ...attrs, isVerified: true });

    const response = await api.post("/api/auth/login").send({ email: attrs.email, password: "WrongPass1" });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid email or password.");
  });

  it("refuses an email that was never registered, with the same message as a wrong password", async () => {
    const response = await api
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "Str0ngPassword1" });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid email or password.");
  });

  it("refuses a correct password on an account still pending admin verification", async () => {
    const attrs = userAttrs();
    await createUser({ ...attrs, isVerified: false });

    const response = await api.post("/api/auth/login").send({ email: attrs.email, password: attrs.password });

    expect(response.status).toBe(403);
  });

  it("refuses a soft-deleted account without revealing it once existed", async () => {
    const attrs = userAttrs();
    await createUser({ ...attrs, isVerified: true, deletedAt: new Date() });

    const response = await api.post("/api/auth/login").send({ email: attrs.email, password: attrs.password });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid email or password.");
  });
});
