/**
 * Process-wide progress counter for the in-flight backup, so the dashboard
 * can poll and show a percentage instead of an indefinite "Preparing…".
 *
 * Two phases, both worth surfacing separately:
 *   "fetching"   - downloading each submission's audio from Cloudinary
 *                  (AUDIO_FETCH_CONCURRENCY in flight at once).
 *   "finalizing" - compressing and streaming the finished zip to the client.
 * Fetching used to dominate wall-clock time, but audio entries are now
 * stored uncompressed (see backup.service.js) since WAV/PCM barely
 * compresses anyway, so finalizing is usually the fast tail - except when
 * it isn't (a slow client connection, an unusually large dataset), which is
 * exactly why this phase needs its own visible state instead of the UI
 * sitting on a stale "100%" with no indication anything is still happening.
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
  if (state) state.phase = phase;
};

const finish = () => {
  state = null;
};

const current = () => {
  if (!state) return { active: false, total: 0, done: 0, percent: null, phase: null };
  const percent = state.total > 0 ? Math.round((state.done / state.total) * 100) : 100;
  return { active: true, total: state.total, done: state.done, percent, phase: state.phase };
};

module.exports = { start, increment, setPhase, finish, current };
