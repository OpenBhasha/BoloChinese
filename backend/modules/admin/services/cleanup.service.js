/**
 * Post-backup wipe. Deletes the finished set (completed/discarded tasks that
 * were already frozen into the last backup), after folding each annotator's
 * finished counts into the permanent progress ledger. Unfinished work and the
 * ledger itself are left alone.
 *
 * Refuses to run unless there is a backup newer than the last cleanup, and uses
 * that backup's cutoff as the delete high-water mark - anything finished after
 * the backup waits for the next cycle, so nothing is deleted that was not
 * archived first.
 */
const dao = require("../dao/admin.dao");
const logger = require("../../../logging/logger");
const { deleteAudioBulk } = require("../../../services/cloudinary.service");
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

    const result = await dao.runCleanupDeletion({ cutoff, date });

    let audioDeleted = 0;
    let audioError = null;
    if (result.audioPublicIds.length) {
      try {
        await deleteAudioBulk(result.audioPublicIds);
        audioDeleted = result.audioPublicIds.length;
      } catch (err) {
        audioError = err.message;
        logger.warn(
          `cleanup: Cloudinary purge failed for ${result.audioPublicIds.length} file(s): ${err.message}`
        );
      }
    }

    const stats = {
      date,
      tasksDeleted: result.tasksDeleted,
      submissionsDeleted: result.submissionsDeleted,
      usersSnapshotted: result.usersSnapshotted,
      audioDeleted,
      audioError,
    };

    await dao.setCleanupCompleted({ stats });
    logger.info(
      `Cleanup done | ${date} | ${stats.tasksDeleted} tasks, ${stats.submissionsDeleted} submissions, ` +
        `${audioDeleted} audio purged`
    );
    return stats;
  } finally {
    lock.release();
  }
};

module.exports = { runCleanup };
