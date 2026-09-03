/**
 * Tiny CSV serialiser for admin result exports. No external dependency — the
 * project only ships csv-parse (read side), not a stringifier.
 */
const escapeCell = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * @param {Array<{key: string, header: string}>} columns
 * @param {Array<object>} rows
 * @returns {string} CSV text with a header row and CRLF line endings
 */
const toCsv = (columns, rows) => {
  const head = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(","));
  return [head, ...body].join("\r\n");
};

module.exports = { toCsv };
