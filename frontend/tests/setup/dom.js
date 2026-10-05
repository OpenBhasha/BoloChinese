import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// jsdom implements neither navigation nor object URLs. The axios client
// redirects via `window.location.href` on a 401, and downloadBlob needs
// createObjectURL; recording stubs keep both paths assertable.
const stubLocation = () =>
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      href: "http://localhost:3000/",
      origin: "http://localhost:3000",
      pathname: "/",
      search: "",
      hash: "",
      assign: vi.fn(),
      replace: vi.fn(),
      reload: vi.fn(),
    },
  });

const stubObjectUrls = () => {
  window.URL.createObjectURL = vi.fn(() => "blob:http://localhost:3000/stub");
  window.URL.revokeObjectURL = vi.fn();
};

beforeEach(() => {
  stubLocation();
  stubObjectUrls();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
