import axios from "axios";

// In dev (npm run dev) this is Vite's own build-time inlining of VITE_API_BASE_URL.
// In the Docker/nginx image there is no build-time value to inline - the container
// doesn't know its deployed API URL until it starts - so window.__ENV__ (written by
// docker-entrypoint.d/40-env-config.sh from the *runtime* container env var, before
// nginx starts serving) takes precedence when present.
const apiBaseUrl =
  (typeof window !== "undefined" && window.__ENV__?.VITE_API_BASE_URL) ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:5000/api";

const api = axios.create({
  baseURL: apiBaseUrl,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear auth and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;
