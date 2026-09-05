/**
 * Local file audio storage. Replaces the earlier Cloudinary integration.
 *
 * Files land at:  <BACKEND_ROOT>/uploads/audio/<userId>/<taskId>_<ts>.wav
 * The relative path (audio/<userId>/<taskId>_<ts>.wav) is what gets stored
 * on the TaskSubmission.audio.publicId field, so the DB stays untouched -
 * downstream code still asks for `audio.publicId` and streaming resolves the
 * absolute path off of it. audio.url is left blank; the frontend already
 * calls /api/user/tasks/:id/audio (or the admin variant) to stream bytes.
 */
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const logger = require("../logging/logger");

// <BACKEND_ROOT> = one level up from /services.
const BACKEND_ROOT = path.resolve(__dirname, "..");
const UPLOAD_ROOT = path.join(BACKEND_ROOT, "uploads", "audio");

const safeSegment = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");

const absoluteFor = (relPath) => {
  const abs = path.join(BACKEND_ROOT, relPath);
  // Refuse anything that escapes the upload root - defence against a bad
  // relPath from an old submission accidentally including "..".
  if (!abs.startsWith(UPLOAD_ROOT + path.sep) && abs !== UPLOAD_ROOT) {
    throw new Error(`Refusing to serve audio outside the uploads root: ${relPath}`);
  }
  return abs;
};

const uploadAudio = async (buffer, taskId, userId) => {
  const userDir = path.join(UPLOAD_ROOT, safeSegment(userId));
  await fsp.mkdir(userDir, { recursive: true });

  const filename = `${safeSegment(taskId)}_${Date.now()}.wav`;
  const abs = path.join(userDir, filename);
  await fsp.writeFile(abs, buffer);

  const relPath = path.relative(BACKEND_ROOT, abs);
  logger.info(`Audio saved locally | ${relPath} | ${buffer.length} bytes`);
  return {
    publicId: relPath,        // stored on submission.audio.publicId
    url: "",                   // no public URL - streaming is admin/user gated
    fileSizeBytes: buffer.length,
  };
};

const deleteAudio = async (publicId) => {
  if (!publicId) return;
  try {
    await fsp.unlink(absoluteFor(publicId));
    logger.info(`Audio deleted locally | ${publicId}`);
  } catch (err) {
    // Missing file is fine (already gone) - anything else we surface.
    if (err.code === "ENOENT") return;
    throw err;
  }
};

/**
 * Stream a stored audio file back to the caller. Returns a readable stream
 * of bytes so it can be piped to the HTTP response, matching the old
 * Cloudinary streaming contract used by the audio endpoints.
 */
const getAudioStream = async (publicIdOrPath) => {
  if (!publicIdOrPath) {
    const err = new Error("Audio path is required.");
    err.statusCode = 400;
    throw err;
  }
  const abs = absoluteFor(publicIdOrPath);
  try {
    await fsp.access(abs, fs.constants.R_OK);
  } catch {
    const err = new Error("Audio file is missing on disk.");
    err.statusCode = 404;
    throw err;
  }
  return fs.createReadStream(abs);
};

/**
 * Total bytes stored under a user's audio directory. Used by the reset
 * script when nuking local audio for a fresh start.
 */
const clearAllAudio = async () => {
  try {
    await fsp.rm(UPLOAD_ROOT, { recursive: true, force: true });
    await fsp.mkdir(UPLOAD_ROOT, { recursive: true });
    logger.info(`Local audio store cleared: ${UPLOAD_ROOT}`);
  } catch (err) {
    logger.warn(`Could not clear local audio store: ${err.message}`);
    throw err;
  }
};

module.exports = { uploadAudio, deleteAudio, getAudioStream, clearAllAudio, UPLOAD_ROOT };
