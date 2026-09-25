/**
 * Post-backup sweep. Nothing is deleted from the database: every finished
 * task/submission (completed/discarded, already frozen into the last backup)
 * has its Cloudinary audio purged and is then marked archived/backed-up so it
 * disappears from the annotator's task list. Progress keeps reading straight
 * off these same rows forever - there's no separate ledger write here, since
 * nothing is being destroyed that would otherwise be lost.
 *
 * Refuses to run unless there is a backup newer than the last cleanup, and
 * uses that backup's cutoff as the high-water mark - anything finished after
 * the backup waits for the next cycle, so audio is never purged before it's
 * been archived.
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
    const state = await dao.getBackupState();

    if (!state.lastBackupAt) {
      const err = new Error("Download a backup before running a cleanup.");
      err.statusCode = 409;
      throw err;
    }
    if (state.lastBackupHadErrors) {
      const err = new Error(
        "The last backup reported audio download errors. Re-download a clean backup before cleaning up."
      );
      err.statusCode = 409;
      throw err;
    }
    if (state.lastCleanupAt && new Date(state.lastCleanupAt) >= new Date(state.lastBackupAt)) {
      const err = new Error("No new backup since the last cleanup. Download a fresh backup first.");
      err.statusCode = 409;
      throw err;
    }

    const cutoff = new Date(state.lastBackupAt);
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
