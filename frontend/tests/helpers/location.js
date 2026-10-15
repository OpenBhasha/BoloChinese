import { vi } from "vitest";

// Captured before any test replaces it.
const realLocation = Object.getOwnPropertyDescriptor(window, "location");

// jsdom does not implement navigation, so assigning window.location.href (as the
// axios client does on a 401) would log an error and leave nothing to assert on.
// The stub records the assignment instead.
export const stubLocation = () =>
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

// For code that owns a BrowserRouter: it reads and writes the real jsdom
// location through the History API, which the stub cannot follow.
export const useRealLocation = (path = "/") => {
  Object.defineProperty(window, "location", realLocation);
  window.history.replaceState({}, "", path);
};
