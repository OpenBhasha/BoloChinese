/**
 * Archives the finished set (completed/discarded tasks, untouched as of the
 * moment this runs) and purges their Cloudinary audio. Nothing is deleted
 * from the database: a task is marked archived (hidden from the annotator's
 * task list) and its submissions are kept - progress keeps reading straight
 * off those same rows forever.
 *
 * There is no "you must back up first" check here - that's a deliberate
 * choice (see the Dashboard change that removed the in-app zip download):
 * the admin is expected to have already captured anything they need through
 * their own external process before running this. This action is exactly as
 * destructive as it looks - it permanently deletes audio from Cloudinary the
 * moment it runs, with no undo.
 *
 * A submission's Cloudinary purge is confirmed per-id: only ids Cloudinary
 * actually reports as deleted (or already gone) get marked backed-up. A
 * failure leaves that submission untouched so the next cleanup retries it -
 * nothing is ever marked "backed up" while its audio might still be sitting
 * on Cloudinary.
 */
const dao = require("../dao/admin.dao");
const logger = require("../../../logging/logger");
const { deleteAudioBulkConfirmed } = require("../../../services/cloudinary.service");
const { kolkataDate } = require("../../../services/datetime");
const lock = require("./backupLock");

const runCleanup = async () => {
  lock.acquire("cleanup");
  try {
    const cutoff = new Date();
    const date = kolkataDate(cutoff);

    const { submissions } = await dao.getCleanupCandidates(cutoff);
    if (!submissions.length) {
      const stats = { date, tasksArchived: 0, submissionsBackedUp: 0, audioPurged: 0, audioFailed: 0, usersInvolved: 0 };
      await dao.setCleanupCompleted({ stats });
      return stats;
    }

    const withAudio = submissions.filter((s) => s.publicId);
    const withoutAudio = submissions.filter((s) => !s.publicId);

    let succeededPublicIds = new Set();
    let audioFailed = 0;
    if (withAudio.length) {
      try {
        const result = await deleteAudioBulkConfirmed(withAudio.map((s) => s.publicId));
        succeededPublicIds = new Set(result.succeeded);
        audioFailed = result.failed.length;
      } catch (err) {
        // Cloudinary not configured, or every batch errored - nothing purged
        // this round; every audio-bearing submission is left for a retry.
        audioFailed = withAudio.length;
        logger.warn(`cleanup: Cloudinary purge unavailable: ${err.message}`);
      }
    }

    const succeededIds = [
      ...withoutAudio.map((s) => s._id),
      ...withAudio.filter((s) => succeededPublicIds.has(s.publicId)).map((s) => s._id),
    ];

    const { tasksArchived, usersInvolved } = await dao.finalizeCleanup({ cutoff, succeededIds });

    const stats = {
      date,
      tasksArchived,
      submissionsBackedUp: succeededIds.length,
      audioPurged: succeededPublicIds.size,
      audioFailed,
      usersInvolved,
    };

    await dao.setCleanupCompleted({ stats });
    logger.info(
      `Cleanup done | ${date} | ${stats.tasksArchived} tasks archived, ${stats.submissionsBackedUp} submissions ` +
        `backed up, ${stats.audioPurged} audio purged (${stats.audioFailed} failed)`
    );
    return stats;
  } finally {
    lock.release();
  }
};

module.exports = { runCleanup };
