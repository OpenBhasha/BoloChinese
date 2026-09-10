/**
 * Process-wide mutex so a backup and a cleanup can never run at the same time,
 * and neither can run twice concurrently. Single-node deployment, so an
 * in-memory flag is enough.
 */
let held = null; // "backup" | "cleanup" | null

const acquire = (op) => {
  if (held) {
    const err = new Error(`A ${held} is already in progress. Try again once it finishes.`);
    err.statusCode = 409;
    throw err;
  }
  held = op;
};

const release = () => {
  held = null;
};

const current = () => held;

module.exports = { acquire, release, current };
