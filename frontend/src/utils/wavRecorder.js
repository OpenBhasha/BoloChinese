// Captures microphone audio through the Web Audio API and encodes it as a real
// mono 16-bit PCM WAV at a fixed target sample rate (16 kHz). This is what the
// backend enforces on upload, so the recorder has to produce it exactly.

const TARGET_SAMPLE_RATE = 16000;

function flatten(chunks, totalLength) {
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Average-based downsample. `inputRate` must be >= `targetRate`.
function downsample(buffer, inputRate, targetRate) {
  if (targetRate >= inputRate) return buffer;
  const ratio = inputRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // audioFormat = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = sampleRate * blockAlign
  view.setUint16(32, 2, true); // blockAlign = channels * bitsPerSample/8
  view.setUint16(34, 16, true); // bitsPerSample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
  }

  return new Blob([view], { type: "audio/wav" });
}

/**
 * @param {MediaStream} stream  a live microphone stream (mono preferred)
 * @returns {{ stop: () => Promise<Blob>, context: AudioContext }}
 */
export function createPcmRecorder(stream) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  // Ask for 16 kHz directly; browsers that ignore it are handled by downsample().
  let context;
  try {
    context = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    context = new AudioCtx();
  }

  if (context.state === "suspended") context.resume();

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let length = 0;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    chunks.push(copy);
    length += copy.length;
  };

  source.connect(processor);
  // ScriptProcessor only fires while connected to the destination.
  processor.connect(context.destination);

  const stop = async () => {
    processor.disconnect();
    source.disconnect();
    const inputRate = context.sampleRate;
    try {
      await context.close();
    } catch {
      /* already closed */
    }
    const merged = flatten(chunks, length);
    const resampled = downsample(merged, inputRate, TARGET_SAMPLE_RATE);
    return encodeWav(resampled, TARGET_SAMPLE_RATE);
  };

  return { stop, context };
}

export const RECORDER_SAMPLE_RATE = TARGET_SAMPLE_RATE;
export const RECORDER_BIT_DEPTH = 16;
