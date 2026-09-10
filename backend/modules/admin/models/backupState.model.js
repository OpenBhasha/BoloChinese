const mongoose = require("mongoose");

// Singleton (_id: "singleton"). Tracks the backup <-> cleanup handshake so the
// dashboard can gate the "Clean up" button and the cleanup endpoint can refuse
// to wipe anything that has not been backed up first.
const backupStateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "singleton" },

    lastBackupAt: { type: Date, default: null },
    lastBackupHadErrors: { type: Boolean, default: false },
    lastBackupStats: { type: mongoose.Schema.Types.Mixed, default: null },

    lastCleanupAt: { type: Date, default: null },
    lastCleanupStats: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, _id: false }
);

module.exports = mongoose.model("BackupState", backupStateSchema);
