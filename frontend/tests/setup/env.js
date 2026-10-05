import { beforeEach, vi } from "vitest";
import { API_BASE_URL } from "../config.js";

vi.stubEnv("VITE_API_BASE_URL", API_BASE_URL);

// src/api/axios.js prefers window.__ENV__ (written at container start) over the
// build-time value, so clear it unless a test opts into that path.
beforeEach(() => {
  delete window.__ENV__;
});
