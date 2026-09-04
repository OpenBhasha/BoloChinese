/**
 * Character-level edit distance used to gauge how heavy a transcript
 * correction is. Per the annotation guidelines each Chinese character counts
 * as one "word", so we diff on the array of code points (whitespace ignored so
 * reflowing does not register as an edit).
 */
const toChars = (value = "") => Array.from(String(value).replace(/\s+/g, ""));

const charEditDistance = (a = "", b = "") => {
  const s = toChars(a);
  const t = toChars(b);
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  let prev = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
    }
    prev = curr;
  }

  return prev[t.length];
};

/**
 * @returns {{ distance: number, base: number, ratio: number }}
 *   distance - changed characters, base - length of the original,
 *   ratio - distance / base (0 when the original was empty).
 */
const measureEdit = (original = "", corrected = "") => {
  const distance = charEditDistance(original, corrected);
  const base = toChars(original).length;
  return { distance, base, ratio: base ? distance / base : (distance ? 1 : 0) };
};

module.exports = { charEditDistance, measureEdit };
