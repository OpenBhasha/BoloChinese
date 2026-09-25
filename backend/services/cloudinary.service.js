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

  // Cloudinary re-packages the WAV container on ingest (resource_type:
  // "video", format: "wav"), so the stored/served file is a few bytes off
  // from the raw buffer we sent. Use Cloudinary's own reported size
  // (result.bytes) so what we record matches what it actually serves back.
  const fileSizeBytes = result.bytes ?? buffer.length;
  logger.info(`Audio uploaded to Cloudinary | publicId: ${result.public_id} | size: ${fileSizeBytes} bytes`);
  return {
    publicId: result.public_id,
    url: result.secure_url,
    fileSizeBytes,
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

// Per-id confirmed variant for the backup/cleanup flow: a submission is only
// marked backed-up (and its parent task archived) once we KNOW its audio is
// gone, so callers need to know exactly which ids succeeded vs. failed rather
// than a single all-or-nothing outcome. A batch that throws (network/auth
// error, no response at all) marks every id in that batch as failed so it's
// retried on the next cleanup instead of being silently treated as purged.
// "not_found" counts as success - the file's already gone either way.
const deleteAudioBulkConfirmed = async (publicIds = []) => {
  const ids = [...new Set(publicIds.filter(Boolean))];
  if (!ids.length) return { succeeded: [], failed: [] };
  assertConfigured();

  const succeeded = [];
  const failed = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await cloudinary.api.delete_resources(batch, {
        resource_type: "video",
        invalidate: true,
      });
      const deletedMap = res.deleted || {};
      batch.forEach((id) => {
        const status = deletedMap[id];
        if (status === "deleted" || status === "not_found") succeeded.push(id);
        else failed.push(id);
      });
    } catch (err) {
      logger.warn(`Cloudinary confirmed-delete failed for a batch of ${batch.length}: ${err.message}`);
      failed.push(...batch);
    }
  }

  logger.info(`Audio deleted from Cloudinary | ${succeeded.length} confirmed, ${failed.length} failed`);
  return { succeeded, failed };
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

// Account-wide storage/credit usage, for the dashboard's "how much Cloudinary
// storage is used" display. Cloudinary's response shape depends on plan
// type: older plans report an explicit storage.limit (bytes); newer
// credits-based plans fold storage/bandwidth/transformations into one
// shared credits.limit instead and may omit storage.limit entirely - the
// caller has to handle either being null, there's no way to always have both.
const getUsage = async () => {
  assertConfigured();

  const result = await cloudinary.api.usage();
  return {
    plan: result.plan || null,
    lastUpdated: result.last_updated || null,
    storageUsedBytes: result.storage?.usage ?? null,
    storageLimitBytes: result.storage?.limit ?? null,
    creditsUsage: result.credits?.usage ?? null,
    creditsLimit: result.credits?.limit ?? null,
    creditsUsedPercent: result.credits?.used_percent ?? null,
  };
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

module.exports = {
  uploadAudio, deleteAudio, deleteAudioBulk, deleteAudioBulkConfirmed, deleteAllAudio, getAudioStream, getUsage,
};