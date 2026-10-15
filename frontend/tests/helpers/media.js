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

/**
 * A Web Audio stand-in that records what the recorder wires up, and lets a
 * test feed sample frames through the ScriptProcessor like a live mic would.
 *
 * @param sampleRate        the rate the "browser" actually runs at; most
 *                          ignore a 16 kHz request and run at 44.1/48 kHz
 * @param rejectsOptions    mimic older engines whose constructor throws on
 *                          an options argument
 * @param closeFails        mimic a context that was already closed
 */
export const installFakeAudioContext = ({
  sampleRate = 16000,
  rejectsOptions = false,
  closeFails = false,
  state = "running",
} = {}) => {
  const contexts = [];

  class FakeAudioContext {
    constructor(options) {
      if (options && rejectsOptions) throw new TypeError("options not supported");
      this.requestedOptions = options;
      this.sampleRate = sampleRate;
      this.state = state;
      this.destination = {};
      this.resume = vi.fn(async () => { this.state = "running"; });
      this.close = vi.fn(async () => {
        if (closeFails) throw new DOMException("already closed", "InvalidStateError");
        this.state = "closed";
      });
      this.source = { connect: vi.fn(), disconnect: vi.fn() };
      this.processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
      contexts.push(this);
    }

    createMediaStreamSource() {
      return this.source;
    }

    createScriptProcessor() {
      return this.processor;
    }
  }

  vi.stubGlobal("AudioContext", FakeAudioContext);

  const context = () => contexts.at(-1);

  return {
    context,
    /** Push one buffer of mono samples through the processor. */
    emit: (samples) =>
      context().processor.onaudioprocess({
        inputBuffer: { getChannelData: () => Float32Array.from(samples) },
      }),
  };
};
