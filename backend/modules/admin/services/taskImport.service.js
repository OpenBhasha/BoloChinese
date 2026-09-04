const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

const SUPPORTED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);

// Extension is the authoritative check - browsers/OS report wildly inconsistent
// MIME types for CSV (text/csv, application/vnd.ms-excel, application/csv,
// text/plain depending on platform), so gating on MIME here would just be
// unreliable rather than safer.
const taskImportUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();

    if (SUPPORTED_EXTENSIONS.has(extension)) {
      cb(null, true);
      return;
    }

    cb(new Error("Only Excel (.xlsx, .xls) or CSV (.csv) files are accepted."), false);
  },
});

module.exports = taskImportUpload;
