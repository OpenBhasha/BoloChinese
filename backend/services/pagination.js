/**
 * Shared pagination parsing + response-meta helper. Pairs with
 * validators/common.validator.js `validatePagination` on the route.
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Reads ?page & ?limit off req.query, clamped to sane bounds.
const parsePagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limitRaw = parseInt(query.limit, 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, limitRaw));
  return { page, limit, skip: (page - 1) * limit };
};

const buildMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  hasMore: page * limit < total,
});

// Escape a user string for safe use inside a RegExp (search filters).
const escapeRegex = (str = "") => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = { parsePagination, buildMeta, escapeRegex, DEFAULT_LIMIT, MAX_LIMIT };
