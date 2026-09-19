import { User } from "../helpers/models.js";
import { nextSequence } from "./sequence.js";

// Satisfies the register validator: 6+ characters, one uppercase, one digit.
// Exported because tests that assert on login need the plaintext.
export const DEFAULT_PASSWORD = "Str0ngPassword1";

// Phone numbers come from an Indian mobile range libphonenumber accepts, so
// the validator's E.164 normalisation is exercised rather than side-stepped.
export const userAttrs = (overrides = {}) => {
  const n = nextSequence();

  return {
    name: `Test Annotator ${numberToWords(n)}`,
    email: `annotator${n}@example.com`,
    phone: `+9198765${String(10000 + n).padStart(5, "0")}`,
    password: DEFAULT_PASSWORD,
    ...overrides,
  };
};

// Persists a user directly, bypassing HTTP. Defaults to a verified annotator,
// since an unverified one cannot log in. Use the register endpoint instead
// when registration itself is what is under test.
export const createUser = async (overrides = {}) => {
  const { name, email, phone, password } = userAttrs(overrides);

  return User.create({
    name,
    email,
    phone,
    password,
    username: overrides.username ?? email.split("@")[0],
    role: overrides.role ?? "user",
    isVerified: overrides.isVerified ?? true,
    deletedAt: overrides.deletedAt ?? null,
    identityFlagged: overrides.identityFlagged ?? false,
    identityFlagReason: overrides.identityFlagReason ?? "",
    dedicatedProjectId: overrides.dedicatedProjectId ?? null,
  });
};

export const createAdmin = async (overrides = {}) =>
  createUser({ role: "admin", isVerified: true, ...overrides });

// The register validator allows only letters, spaces, hyphens and apostrophes
// in a name, so the sequence cannot be spelled with digits.
const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const numberToWords = (n) =>
  String(n)
    .split("")
    .map((digit) => WORDS[Number(digit)])
    .join(" ");
