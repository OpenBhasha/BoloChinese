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

// On 401, clear auth and redirect to login. A 401 from /auth/* is a rejected
// sign-in, not an expired session - redirecting there would reload the login
// page and discard the error before the user can read it. If an admin was
// impersonating a user (the short-lived token just expired), drop back into
// the admin's own session instead of kicking them out entirely.
const isAuthRequest = (config) => config?.url?.startsWith("/auth/");

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !isAuthRequest(err.config)) {
      // Several requests are usually in flight at once. If this 401 belongs to
      // a token we've already swapped out (e.g. an impersonation token the first
      // failure just replaced with the admin's), don't clear the new session.
      const sentToken = String(err.config?.headers?.Authorization || "").replace("Bearer ", "");
      const currentToken = localStorage.getItem("token");
      if (sentToken && currentToken && sentToken !== currentToken) return Promise.reject(err);

      let adminSession = null;
      try { adminSession = JSON.parse(localStorage.getItem("adminSession")); } catch { /* ignore */ }
      if (adminSession?.token) {
        localStorage.setItem("token", adminSession.token);
        localStorage.setItem("user", JSON.stringify(adminSession.user));
        localStorage.removeItem("adminSession");
        window.location.href = adminSession.returnTo || "/admin";
        return Promise.reject(err);
      }
      localStorage.removeItem("adminSession");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;
