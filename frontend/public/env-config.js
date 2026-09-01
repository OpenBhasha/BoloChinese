// Placeholder for local dev/preview (npm run dev / vite preview): no runtime
// overrides, so axios.js falls back to Vite's own VITE_API_BASE_URL/default.
// In the Docker image this file is overwritten at container startup by
// docker-entrypoint.d/40-env-config.sh with the real runtime API URL.
window.__ENV__ = {};
