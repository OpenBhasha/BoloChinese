const https = require("https");
const { PassThrough } = require("stream");
const { v2: cloudinary } = require("cloudinary");
const config = require("../properties/config");
const logger = require("../logging/logger");

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure: true,
});

const assertConfigured = () => {
  if (!config.cloudinary.cloudName || !config.cloudinary.apiKey || !config.cloudinary.apiSecret) {
    const err = new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
    err.statusCode = 500;
    throw err;
  }
};

const uploadAudio = async (buffer, taskId, userId) => {
  assertConfigured();

  const publicId = `bolo/audio/${userId}/${taskId}_${Date.now()}`;
  const result = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        public_id: publicId,
        format: "wav",
        overwrite: true,
      },
      (error, uploaded) => {
        if (error) return reject(error);
        resolve(uploaded);
      }
    );

    const inputStream = new PassThrough();
    inputStream.end(buffer);
    inputStream.pipe(uploadStream);
  });

  logger.info(`Audio uploaded to Cloudinary | publicId: ${result.public_id} | size: ${buffer.length} bytes`);
  return {
    publicId: result.public_id,
    url: result.secure_url,
    fileSizeBytes: buffer.length,
  };
};

const deleteAudio = async (publicId) => {
  if (!publicId) return;
  assertConfigured();

  await cloudinary.uploader.destroy(publicId, {
    resource_type: "video",
    invalidate: true,
  });

  logger.info(`Audio deleted from Cloudinary | publicId: ${publicId}`);
};

// Bulk variant for cascade deletes (a project or task taking its submissions
// down with it). delete_resources caps at 100 ids per call, so we page.
const deleteAudioBulk = async (publicIds = []) => {
  const ids = [...new Set(publicIds.filter(Boolean))];
  if (!ids.length) return;
  assertConfigured();

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    // eslint-disable-next-line no-await-in-loop
    await cloudinary.api.delete_resources(batch, {
      resource_type: "video",
      invalidate: true,
    });
  }

  logger.info(`Audio deleted from Cloudinary | ${ids.length} file(s)`);
};

// Full sweep of every uploaded audio under the bolo/audio/ prefix. Used by the
// admin database reset. Mirrors backend/reset.js's wipeCloudinary().
const AUDIO_PREFIX = "bolo/audio/";
const deleteAllAudio = async () => {
  assertConfigured();

  let cursor;
  let deleted = 0;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await cloudinary.api.resources({
      type: "upload",
      resource_type: "video",
      prefix: AUDIO_PREFIX,
      max_results: 100,
      next_cursor: cursor,
    });
    const ids = (page.resources || []).map((r) => r.public_id);
    if (ids.length) {
      // eslint-disable-next-line no-await-in-loop
      const res = await cloudinary.api.delete_resources(ids, { resource_type: "video", invalidate: true });
      deleted += Object.values(res.deleted || {}).filter((s) => s === "deleted").length;
    }
    cursor = page.next_cursor;
  } while (cursor);

  await cloudinary.api.delete_folder(AUDIO_PREFIX).catch(() => {});
  logger.info(`Cloudinary: wiped ${deleted} audio file(s) under ${AUDIO_PREFIX}`);
  return deleted;
};

const getAudioStream = async (audioUrl) => {
  if (!audioUrl) {
    const err = new Error("Audio URL is required.");
    err.statusCode = 400;
    throw err;
  }

  return new Promise((resolve, reject) => {
    const request = https.get(audioUrl, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        response.resume();
        return reject(new Error(`Cloudinary audio fetch failed with status ${response.statusCode}`));
      }

      resolve(response);
    });

    request.on("error", reject);
  });
};

module.exports = { uploadAudio, deleteAudio, deleteAudioBulk, deleteAllAudio, getAudioStream };