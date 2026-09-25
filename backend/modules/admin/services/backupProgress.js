/**
 * Process-wide progress counter for the in-flight backup, so the dashboard
 * can poll and show a percentage instead of an indefinite "Preparing…".
 *
 * Two phases, each with its own real {done, total}, not just an indeterminate
 * spinner for the second one:
 *   "fetching"   - downloading each submission's audio from Cloudinary
 *                  (AUDIO_FETCH_CONCURRENCY in flight at once). Tracked by a
 *                  plain counter here since the total is known up front.
 *   "finalizing" - compressing and streaming the finished zip out. Tracked
 *                  from archiver's own 'progress' event (entries processed
 *                  vs. total) - see backup.service.js - since that's the
 *                  actual source of truth for work remaining once every
 *                  append() has already happened.
 *
 * Reported via GET /admin/backup/status, which the client already polls -
 * that's a small, separate JSON response, so it keeps working even if a
 * reverse proxy in front of the app buffers the large zip response itself.
 *
 * Single-node deployment, one backup at a time (backupLock enforces that),
 * so a module-level singleton is enough - same pattern as backupLock.js.
 */
let state = null; // { total, done, phase: "fetching" | "finalizing" } | null

const start = (total) => {
  state = { total, done: 0, phase: "fetching" };
};

const increment = () => {
  if (state) state.done += 1;
};

const setPhase = (phase) => {
  if (!state) return;
  state.phase = phase;
  if (phase === "finalizing") {
    // total is null (not 0) here specifically to mean "not known yet" -
    // archiver's first 'progress' event is normally near-instant, but until
    // it arrives we don't want to claim either 0% or a false 100%.
    state.done = 0;
    state.total = null;
  }
};

// Only takes effect once we're in the finalizing phase - during fetching,
// archiver's entry count is still growing as audio gets appended, and would
// misreport progress against a denominator that hasn't settled yet.
const setFinalizeProgress = (done, total) => {
  if (state && state.phase === "finalizing") {
    state.done = done;
    state.total = total;
  }
};

const finish = () => {
  state = null;
};

const current = () => {
  if (!state) return { active: false, total: 0, done: 0, percent: null, phase: null };
  const percent =
    state.total === null ? null : state.total > 0 ? Math.round((state.done / state.total) * 100) : 100;
  return { active: true, total: state.total, done: state.done, percent, phase: state.phase };
};

module.exports = { start, increment, setPhase, setFinalizeProgress, finish, current };
