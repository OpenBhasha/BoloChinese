export const formatDateTime = (value) => {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
};

export const formatFileSize = (bytes) => {
  if (!bytes) return "0 KB";
  return `${(bytes / 1024).toFixed(1)} KB`;
};
