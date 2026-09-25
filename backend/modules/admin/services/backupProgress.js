/**
 * Process-wide progress counter for the in-flight backup, so the dashboard
 * can poll and show a percentage instead of an indefinite "Preparing…".
 * Tracks the audio-fetch phase specifically - that's what backupLock and
 * AUDIO_FETCH_CONCURRENCY exist for, and it dominates wall-clock time for any
 * dataset large enough for progress to matter. The CSV/manifest tail after
 * it is fast, so sitting at 100% briefly while that finishes is fine.
 *
 * Single-node deployment, one backup at a time (backupLock enforces that),
 * so a module-level singleton is enough - same pattern as backupLock.js.
 */
let state = null; // { total, done } | null (null = no backup in flight)

const start = (total) => {
  state = { total, done: 0 };
};

const increment = () => {
  if (state) state.done += 1;
};

const finish = () => {
  state = null;
};

const current = () => {
  if (!state) return { active: false, total: 0, done: 0, percent: null };
  const percent = state.total > 0 ? Math.round((state.done / state.total) * 100) : 100;
  return { active: true, total: state.total, done: state.done, percent };
};

module.exports = { start, increment, finish, current };
