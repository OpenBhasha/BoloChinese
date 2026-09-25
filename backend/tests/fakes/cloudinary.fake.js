import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * In-memory stand-in for services/cloudinary.service.js, replacing the whole
 * module at its boundary.
 *
 * `vi.mock()` is not used: the app source is CommonJS and externalised from
 * Vite's module graph (see vitest.config.mjs), so the require cache is the
 * seam consumers actually resolve through - whether they require the service
 * at load time or lazily inside a handler.
 */
const AUDIO_PREFIX = "bolo/audio/";

const requireCjs = createRequire(import.meta.url);
const SERVICE_PATH = requireCjs.resolve("../../services/cloudinary.service.js");

// Vitest resets the module graph between test files but not the require cache,
// so consumers loaded by an earlier file still hold the first fake. One
// instance per worker keeps cloudinaryFake() pointing at the object those
// consumers are actually writing into.
const INSTANCE = Symbol.for("bolo.tests.cloudinaryFake");

export const createCloudinaryFake = () => {
  /** @type {Map<string, { publicId: string, url: string, buffer: Buffer }>} */
  const store = new Map();
  let uploadCount = 0;

  const uploadAudio = async (buffer, taskId, userId) => {
    uploadCount += 1;
    const publicId = `${AUDIO_PREFIX}${userId}/${taskId}_${uploadCount}`;
    const url = `https://res.cloudinary.test/${publicId}.wav`;

    store.set(publicId, { publicId, url, buffer: Buffer.from(buffer) });

    return { publicId, url, fileSizeBytes: buffer.length };
  };

  const deleteAudio = async (publicId) => {
    if (!publicId) return;
    store.delete(publicId);
  };

  const deleteAudioBulk = async (publicIds = []) => {
    for (const id of new Set(publicIds.filter(Boolean))) store.delete(id);
  };

  // Cleanup's per-submission confirmed variant - no real network to fail
  // against here, so every requested id "succeeds" (mirrors how the real
  // service treats Cloudinary's "deleted" and "not_found" as both fine).
  const deleteAudioBulkConfirmed = async (publicIds = []) => {
    const ids = [...new Set(publicIds.filter(Boolean))];
    ids.forEach((id) => store.delete(id));
    return { succeeded: ids, failed: [] };
  };

  const deleteAllAudio = async () => {
    const deleted = store.size;
    store.clear();
    return deleted;
  };

  const getAudioStream = async (audioUrl) => {
    if (!audioUrl) {
      const err = new Error("Audio URL is required.");
      err.statusCode = 400;
      throw err;
    }

    const stored = [...store.values()].find((entry) => entry.url === audioUrl);
    if (!stored) throw new Error("Cloudinary audio fetch failed with status 404");

    return Readable.from([stored.buffer]);
  };

  return {
    exports: { uploadAudio, deleteAudio, deleteAudioBulk, deleteAudioBulkConfirmed, deleteAllAudio, getAudioStream },

    // Assert on these rather than on call counts.
    stored: () => [...store.values()],
    storedFor: (publicId) => store.get(publicId),
    has: (publicId) => store.has(publicId),
    size: () => store.size,
    reset: () => {
      store.clear();
      uploadCount = 0;
    },
  };
};

// Called once per worker from tests/setup/fakes.js, before any consumer loads.
export const installCloudinaryFake = () => {
  if (!globalThis[INSTANCE]) globalThis[INSTANCE] = createCloudinaryFake();

  requireCjs.cache[SERVICE_PATH] = {
    id: SERVICE_PATH,
    filename: SERVICE_PATH,
    path: path.dirname(SERVICE_PATH),
    loaded: true,
    children: [],
    paths: [],
    exports: globalThis[INSTANCE].exports,
  };

  return globalThis[INSTANCE];
};

export const cloudinaryFake = () => {
  const fake = globalThis[INSTANCE];
  if (!fake) {
    throw new Error("The Cloudinary fake is not installed. tests/setup/fakes.js should have installed it.");
  }
  return fake;
};
