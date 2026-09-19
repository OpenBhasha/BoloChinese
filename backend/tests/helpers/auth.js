import jwt from "jsonwebtoken";
import config from "../../properties/config.js";
import { createAdmin, createUser } from "../factories/user.factory.js";

// Mints the same token shape loginUser() issues. Use this to arrange a caller
// for a test about something else; tests about authentication itself should go
// through POST /api/auth/login so they exercise the real issuing path.
export const signTokenFor = (user, overrides = {}) =>
  jwt.sign(
    { id: String(user._id), role: user.role, email: user.email, ...overrides },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

export const asAdmin = async (overrides = {}) => {
  const user = await createAdmin(overrides);
  const token = signTokenFor(user);
  return { user, token, headers: bearer(token) };
};

export const asUser = async (overrides = {}) => {
  const user = await createUser(overrides);
  const token = signTokenFor(user);
  return { user, token, headers: bearer(token) };
};

// Structurally valid, signed with the wrong secret.
export const forgedToken = (user) =>
  jwt.sign({ id: String(user._id), role: "admin", email: user.email }, "not-the-real-secret", {
    expiresIn: "1h",
  });
