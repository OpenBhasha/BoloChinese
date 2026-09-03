const { createUser, findUserByEmail, findUserByUsername, findUserByPhone } = require("../dao/register.dao");
const logger = require("../../../logging/logger");

// ─── Username generation ──────────────────────────────────────────────────────
// Build a URL/label-safe base from the person's name, then guarantee uniqueness
// with a numeric suffix. The username doubles as the name of the dedicated
// project created for the annotator once an admin approves the account.
const slugifyName = (name = "") =>
  String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20);

const generateUniqueUsername = async (name) => {
  const base = slugifyName(name) || "annotator";

  // Try the bare base first, then base2, base3, … until one is free.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
    // eslint-disable-next-line no-await-in-loop
    const taken = await findUserByUsername(candidate);
    if (!taken) return candidate;
  }

  // Extremely unlikely fallback — a random suffix.
  return `${base}${Date.now().toString(36)}`;
};

// ─── Anonymous / invalid identity detection ───────────────────────────────────
const PLACEHOLDER_NAMES = new Set([
  "anon", "anonymous", "test", "tester", "testing", "unknown", "user", "users",
  "na", "nan", "none", "null", "xxx", "asdf", "asdfasdf", "qwerty", "abc", "abcd",
  "noname", "nobody", "guest", "demo", "sample", "foo", "bar", "foobar",
]);

// Unambiguous fakes (placeholder words, no letters at all, a single repeated
// character, a name too short to be a name) are rejected outright — letting
// these through would defeat the point of asking for a real name. A bare
// single word is only a soft signal: many cultures use mononyms, so that
// case is flagged for admin review rather than blocked.
const detectIdentityIssue = ({ name = "" }) => {
  const trimmed = String(name).trim();
  const compact = trimmed.toLowerCase().replace(/[^a-z]/g, "");

  if (trimmed.length < 3) {
    return { blocked: true, flagged: true, reason: "Name is too short to be a real full name." };
  }
  if (!/[a-zA-Z]/.test(trimmed)) {
    return { blocked: true, flagged: true, reason: "Name contains no letters." };
  }
  if (PLACEHOLDER_NAMES.has(compact)) {
    return { blocked: true, flagged: true, reason: "Name looks like a placeholder / anonymous value." };
  }
  if (compact.length >= 2 && /^(.)\1+$/.test(compact)) {
    return { blocked: true, flagged: true, reason: "Name is a single repeated character." };
  }
  if (!trimmed.includes(" ") && trimmed.length < 5) {
    return { blocked: false, flagged: true, reason: "Name does not look like a full name." };
  }
  return { blocked: false, flagged: false, reason: "" };
};

const registerUser = async ({ name, email, role, password, phone }) => {
  // Check duplicate email
  const existingEmail = await findUserByEmail(email);
  if (existingEmail) {
    const err = new Error("Email is already registered.");
    err.statusCode = 409;
    throw err;
  }

  // Check duplicate phone — the same person re-registering under a new email
  // is the most common route to a duplicate account, so the phone (already
  // normalized to E.164 by the validator) must also be unique.
  const existingPhone = await findUserByPhone(phone);
  if (existingPhone) {
    const err = new Error("Phone number is already registered.");
    err.statusCode = 409;
    throw err;
  }

  const identity = detectIdentityIssue({ name });
  if (identity.blocked) {
    const err = new Error(`Registration rejected: ${identity.reason}`);
    err.statusCode = 400;
    throw err;
  }

  const username = await generateUniqueUsername(name);

  let user;
  try {
    user = await createUser({
      name,
      email,
      role,
      password,
      phone,
      username,
      identityFlagged: identity.flagged,
      identityFlagReason: identity.reason,
    });
  } catch (mongoErr) {
    // Guards the race window between the pre-checks above and the insert
    // (e.g. two concurrent requests with the same email/phone).
    if (mongoErr.code === 11000) {
      const field = Object.keys(mongoErr.keyPattern || {})[0] || "field";
      const label = field === "phone" ? "Phone number" : field === "email" ? "Email" : "Value";
      const err = new Error(`${label} is already registered.`);
      err.statusCode = 409;
      throw err;
    }
    throw mongoErr;
  }

  logger.info(
    `New user registered: ${user.email} (role: ${user.role}, username: ${user.username})` +
      (identity.flagged ? ` — identity flagged: ${identity.reason}` : "")
  );

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    username: user.username,
    role: user.role,
    isVerified: user.isVerified,
    identityFlagged: user.identityFlagged,
    identityFlagReason: user.identityFlagReason,
    createdAt: user.createdAt,
  };
};

module.exports = { registerUser, generateUniqueUsername, detectIdentityIssue };
