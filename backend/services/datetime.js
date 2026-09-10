/**
 * Date helpers pinned to Asia/Kolkata. The daily task batch is given, worked,
 * backed up, and wiped on an IST calendar day, so every "which day did this
 * happen" question - the progress-ledger key, the backup folder name - resolves
 * against Kolkata regardless of where the server runs.
 */
const KOLKATA_TZ = "Asia/Kolkata";

// en-CA formats as YYYY-MM-DD, which is exactly the key/folder shape we want.
const kolkataDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KOLKATA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// "2026-09-10" for the given instant (defaults to now), in Asia/Kolkata.
const kolkataDate = (date = new Date()) => kolkataDateFormatter.format(date);

module.exports = { KOLKATA_TZ, kolkataDate };
