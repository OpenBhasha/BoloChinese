import { vi } from "vitest";

// jsdom has no mic and no Web Audio API, so the hardware boundary is faked.
// The WAV encoding underneath is covered separately against wavRecorder.js.

export const fakeMediaStream = () => {
  const track = { stop: vi.fn(), kind: "audio" };
  return { getTracks: () => [track], _track: track };
};

export const stubMicrophone = () => {
  const stream = fakeMediaStream();
  const getUserMedia = vi.fn().mockResolvedValue(stream);

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value: { getUserMedia },
  });

  return { stream, getUserMedia };
};

export const denyMicrophone = () => {
  const getUserMedia = vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value: { getUserMedia },
  });

  return { getUserMedia };
};

// A WAV blob large enough to clear the component's `size > 44` empty-take check.
export const wavBlob = (bytes = 2048) =>
  new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
