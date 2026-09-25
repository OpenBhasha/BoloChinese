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

// [start, end) UTC instants spanning one Kolkata calendar day ("2026-09-10",
// defaults to today). Kolkata's +05:30 offset has no DST, so this is exact
// with no timezone database involved.
const kolkataDayRange = (date = kolkataDate()) => {
  const start = new Date(`${date}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
};

module.exports = { KOLKATA_TZ, kolkataDate, kolkataDayRange };
