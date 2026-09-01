// API base URL resolution.
//
// Vite inlines `import.meta.env.VITE_*` at BUILD time, so a container image
// built once cannot pick up an API URL set later in the deployment platform
// (Dokploy, Coolify, ...). To keep runtime configuration possible, the
// container entrypoint writes `/config.js`, which sets `window.__APP_CONFIG__`
// before the app bundle loads.
//
// Resolution order:
//   1. window.__APP_CONFIG__.VITE_API_BASE_URL  (runtime, set by the container)
//   2. import.meta.env.VITE_API_BASE_URL        (build time / `npm run dev`)
//   3. same-origin `/api`                       (frontend proxied to backend)
//   4. http://localhost:5000/api                (local development)

// The entrypoint leaves this literal in place when no URL is configured.
const PLACEHOLDER = "__VITE_API_BASE_URL__";

const clean = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === PLACEHOLDER) return "";
  // Tolerate a trailing slash so ".../api" and ".../api/" behave the same.
  return trimmed.replace(/\/+$/, "");
};

const runtimeConfig =
  typeof window !== "undefined" && window.__APP_CONFIG__ ? window.__APP_CONFIG__ : {};

const isLocalHost = () =>
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]", ""].includes(window.location.hostname);

export const resolveApiBaseUrl = () => {
  const configured =
    clean(runtimeConfig.VITE_API_BASE_URL) || clean(import.meta.env.VITE_API_BASE_URL);
  if (configured) return configured;

  // Nothing configured. On a real deployment, defaulting to localhost is never
  // right — it points the browser at the visitor's own machine and shows up as
  // a CORS/connection error. Use a same-origin path instead, which works when
  // the frontend host proxies /api to the backend.
  return isLocalHost() ? "http://localhost:5000/api" : "/api";
};

export const API_BASE_URL = resolveApiBaseUrl();

export default { API_BASE_URL, resolveApiBaseUrl };
