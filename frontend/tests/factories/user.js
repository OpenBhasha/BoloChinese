import { nextSequence } from "./sequence.js";

export const annotatorUser = (overrides = {}) => {
  const n = nextSequence();

  return {
    _id: `user-${n}`,
    name: `Test Annotator ${n}`,
    email: `annotator${n}@example.com`,
    username: `annotator${n}`,
    phone: `+9198765${String(10000 + n).padStart(5, "0")}`,
    role: "user",
    isVerified: true,
    identityFlagged: false,
    ...overrides,
  };
};

export const adminUser = (overrides = {}) =>
  annotatorUser({ role: "admin", name: "Test Admin", ...overrides });
