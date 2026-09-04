// Mirror of backend/services/textDiff.js - each Chinese character counts as one
// "word", whitespace is ignored so reflowing text is not treated as an edit.
const toChars = (value = "") => Array.from(String(value).replace(/\s+/g, ""));

export const charEditDistance = (a = "", b = "") => {
  const s = toChars(a);
  const t = toChars(b);
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[t.length];
};

export const measureEdit = (original = "", corrected = "") => {
  const distance = charEditDistance(original, corrected);
  const base = toChars(original).length;
  return { distance, base, ratio: base ? distance / base : distance ? 1 : 0 };
};

// Corrections beyond this fraction of the source are outside the
// "minor corrections only" guideline (matches HEAVY_EDIT_RATIO on the backend).
export const HEAVY_EDIT_RATIO = 0.25;
