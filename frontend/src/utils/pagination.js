export const LIST_PAGE_SIZE = 10;

export const paginateRows = (rows, page, pageSize = LIST_PAGE_SIZE) => {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  return {
    rows: rows.slice(startIndex, startIndex + pageSize),
    currentPage,
    totalPages,
  };
};
