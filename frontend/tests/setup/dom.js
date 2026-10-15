import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// jsdom's Blob predates the streams API. MSW needs Blob.stream() to build a
// Response for any request the app makes with responseType: "blob" (audio
// playback), and without it the failure surfaces as an unhandled rejection
// inside the interceptor rather than anywhere useful.
if (typeof Blob !== "undefined" && typeof Blob.prototype.stream !== "function") {
  Blob.prototype.stream = function stream() {
    const bytes = this.arrayBuffer();
    return new ReadableStream({
      async start(controller) {
        controller.enqueue(new Uint8Array(await bytes));
        controller.close();
      },
    });
  };
}

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

// jsdom has no media pipeline, so these throw "Not implemented" and would
// surface as unhandled errors from any component holding an <audio> element.
const stubMediaPlayback = () => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
};

beforeEach(() => {
  stubLocation();
  stubObjectUrls();
  stubMediaPlayback();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
