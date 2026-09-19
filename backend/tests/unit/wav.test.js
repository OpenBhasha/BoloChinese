import { describe, expect, it } from "vitest";
import { assertRecordingFormat, parseWavHeader } from "../../services/wav.js";
import { buildWav } from "../helpers/wav.js";

describe("WAV header parsing", () => {
  it("reads the capture format off a well-formed clip", () => {
    expect(parseWavHeader(buildWav({ durationSeconds: 2 }))).toMatchObject({
      audioFormat: 1,
      channels: 1,
      sampleRate: 16000,
      bitsPerSample: 16,
    });
  });

  it("derives the clip duration from the data chunk", () => {
    expect(parseWavHeader(buildWav({ durationSeconds: 2.5 })).durationSeconds).toBeCloseTo(2.5);
  });

  it("rejects a buffer too short to hold a header", () => {
    expect(() => parseWavHeader(Buffer.alloc(10))).toThrowError(/not a valid WAV file/);
  });

  it("rejects a non-buffer payload", () => {
    expect(() => parseWavHeader("not audio")).toThrowError(/not a valid WAV file/);
  });

  it("rejects a file that is not RIFF/WAVE, such as an MP3 renamed to .wav", () => {
    const notWav = Buffer.alloc(100);
    notWav.write("ID3", 0, "ascii");

    expect(() => parseWavHeader(notWav)).toThrowError(/missing RIFF\/WAVE marker/);
  });

  it("reports a 400 so the error surfaces to the client as a bad request", () => {
    expect.assertions(1);

    try {
      parseWavHeader(Buffer.alloc(10));
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });

  it("does not trust a data chunk size larger than the file itself", () => {
    // Claims 10 seconds of audio but ships only 1.
    const clip = buildWav({ durationSeconds: 1 });
    clip.writeUInt32LE(16000 * 2 * 10, 40);

    expect(parseWavHeader(clip).durationSeconds).toBeCloseTo(1);
  });
});

describe("recording format contract", () => {
  it("accepts a mono 16 kHz 16-bit PCM clip", () => {
    expect(() => assertRecordingFormat(buildWav())).not.toThrow();
  });

  it("rejects a clip recorded at the wrong sample rate", () => {
    expect(() => assertRecordingFormat(buildWav({ sampleRate: 44100 }))).toThrowError(
      /sample rate must be 16000 Hz \(got 44100\)/
    );
  });

  it("rejects a stereo clip", () => {
    expect(() => assertRecordingFormat(buildWav({ channels: 2 }))).toThrowError(/must be mono \(got 2\)/);
  });

  it("rejects a clip at the wrong bit depth", () => {
    expect(() => assertRecordingFormat(buildWav({ bitDepth: 8 }))).toThrowError(/bit depth must be 16-bit/);
  });

  it("rejects compressed audio wrapped in a WAV container", () => {
    expect(() => assertRecordingFormat(buildWav({ audioFormat: 3 }))).toThrowError(
      /must be uncompressed PCM/
    );
  });

  it("names every problem at once, so the client does not fix them one round-trip at a time", () => {
    const message = captureMessage(() =>
      assertRecordingFormat(buildWav({ sampleRate: 44100, channels: 2, bitDepth: 24 }))
    );

    expect(message).toMatch(/sample rate/);
    expect(message).toMatch(/bit depth/);
    expect(message).toMatch(/mono/);
  });

  it("honours a caller-supplied format when the contract differs", () => {
    const clip = buildWav({ sampleRate: 8000 });

    expect(() => assertRecordingFormat(clip)).toThrow();
    expect(() => assertRecordingFormat(clip, { sampleRate: 8000 })).not.toThrow();
  });
});

const captureMessage = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.message;
  }
  throw new Error("Expected the call to throw, but it did not.");
};
