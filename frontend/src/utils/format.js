export const formatDateTime = (value) => {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
};

export const formatFileSize = (bytes) => {
  if (!bytes) return "0 KB";
  return `${(bytes / 1024).toFixed(1)} KB`;
};

// General-purpose byte formatter that scales up to GB/TB - formatFileSize
// above is KB-only, fine for a single audio clip but not for account-wide
// storage totals.
export const formatBytes = (bytes) => {
  const n = Number(bytes) || 0;
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
};

// Seconds -> "m:ss" (or "h:mm:ss" past an hour). Used for recorded-audio totals.
export const formatDuration = (seconds) => {
  const total = Math.round(Number(seconds) || 0);
  if (total <= 0) return "0:00";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

// Trigger a browser download for an Axios blob response.
export const downloadBlob = (data, filename, type = "text/csv") => {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};
