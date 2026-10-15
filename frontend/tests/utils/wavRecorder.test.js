import { describe, expect, it } from "vitest";
import { assertRecordingFormat, parseWavHeader } from "@tests/helpers/backend.js";
import { fakeMediaStream, installFakeAudioContext } from "@tests/helpers/media.js";
import { createPcmRecorder, encodeWav } from "@/utils/wavRecorder.js";

const toBuffer = async (blob) => Buffer.from(await blob.arrayBuffer());

const pcmSamples = (buffer) => {
  const samples = [];
  for (let offset = 44; offset < buffer.length; offset += 2) samples.push(buffer.readInt16LE(offset));
  return samples;
};

const silence = (count) => new Array(count).fill(0);

const record = async (audioContextOptions, frames) => {
  const audio = installFakeAudioContext(audioContextOptions);
  const recorder = createPcmRecorder(fakeMediaStream());
  frames.forEach((frame) => audio.emit(frame));
  return { audio, buffer: await toBuffer(await recorder.stop()) };
};

describe("encodeWav", () => {
  it("produces a file the backend's upload check accepts", async () => {
    const buffer = await toBuffer(encodeWav(Float32Array.from(silence(1600)), 16000));

    expect(assertRecordingFormat(buffer)).toMatchObject({
      audioFormat: 1,
      sampleRate: 16000,
      bitsPerSample: 16,
      channels: 1,
    });
  });

  // The backend never checks these two, but players derive playback length and
  // speed from them, so a wrong value passes upload and then plays incorrectly.
  it("writes a self-consistent header for standard players", async () => {
    const buffer = await toBuffer(encodeWav(Float32Array.from(silence(1600)), 16000));

    expect(parseWavHeader(buffer)).toMatchObject({ byteRate: 32000, blockAlign: 2 });
  });

  it("reports the clip's real duration to the backend", async () => {
    const buffer = await toBuffer(encodeWav(Float32Array.from(silence(8000)), 16000));

    expect(parseWavHeader(buffer).durationSeconds).toBe(0.5);
  });

  it("writes samples as signed 16-bit PCM", async () => {
    const buffer = await toBuffer(encodeWav(Float32Array.from([0, 0.5, -0.5, 1, -1]), 16000));

    expect(pcmSamples(buffer)).toEqual([0, 16383, -16384, 32767, -32768]);
  });

  it("clips out-of-range samples instead of wrapping them into noise", async () => {
    const buffer = await toBuffer(encodeWav(Float32Array.from([1.5, -2]), 16000));

    expect(pcmSamples(buffer)).toEqual([32767, -32768]);
  });

  it("encodes an empty recording as a bare 44-byte header", async () => {
    const blob = encodeWav(new Float32Array(0), 16000);

    // AudioRecorder relies on this exact size to reject an empty take.
    expect(blob.size).toBe(44);
    expect(blob.type).toBe("audio/wav");
  });
});

describe("createPcmRecorder", () => {
  it("asks the browser for 16 kHz audio", () => {
    const audio = installFakeAudioContext();

    createPcmRecorder(fakeMediaStream());

    expect(audio.context().requestedOptions).toEqual({ sampleRate: 16000 });
  });

  it("keeps the frames in the order they were captured", async () => {
    const { buffer } = await record({ sampleRate: 16000 }, [[0.25], [0.5], [-0.5]]);

    expect(pcmSamples(buffer)).toEqual([8191, 16383, -16384]);
  });

  it.each([48000, 44100])(
    "resamples a %i Hz browser to a 16 kHz file the backend accepts, keeping its length",
    async (rate) => {
      const { buffer } = await record({ sampleRate: rate }, [silence(rate / 2), silence(rate / 2)]);

      expect(assertRecordingFormat(buffer).sampleRate).toBe(16000);
      expect(parseWavHeader(buffer).durationSeconds).toBeCloseTo(1, 3);
    }
  );

  it("averages neighbouring frames when downsampling", async () => {
    const { buffer } = await record({ sampleRate: 48000 }, [[0.25, 0.5, 0.75, -0.25, -0.5, -0.75]]);

    expect(pcmSamples(buffer)).toEqual([16383, -16384]);
  });

  it("still records 16 kHz audio on engines that reject constructor options", async () => {
    const { buffer } = await record({ rejectsOptions: true, sampleRate: 48000 }, [silence(48000)]);

    expect(assertRecordingFormat(buffer).sampleRate).toBe(16000);
    expect(parseWavHeader(buffer).durationSeconds).toBeCloseTo(1, 3);
  });

  it("resumes a context the browser started suspended", () => {
    const audio = installFakeAudioContext({ state: "suspended" });

    createPcmRecorder(fakeMediaStream());

    expect(audio.context().resume).toHaveBeenCalled();
  });

  it("disconnects from the mic and releases the audio context when stopped", async () => {
    const { audio } = await record({}, [[0.1]]);
    const context = audio.context();

    expect(context.processor.disconnect).toHaveBeenCalled();
    expect(context.source.disconnect).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });

  it("still returns the recording when the context was already closed", async () => {
    const { buffer } = await record({ closeFails: true }, [silence(1600)]);

    expect(parseWavHeader(buffer).durationSeconds).toBe(0.1);
  });

  it("returns an empty take when no audio arrived", async () => {
    const { buffer } = await record({}, []);

    expect(buffer.length).toBe(44);
  });
});
