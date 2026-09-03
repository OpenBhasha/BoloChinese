/**
 * Minimal RIFF/WAVE header parser — enough to enforce the recording format
 * contract (mono, 16 kHz, 16-bit PCM) and to derive the clip duration.
 *
 * Throws an Error with a 400 statusCode when the buffer is not a well-formed
 * PCM WAV file.
 */
const parseWavHeader = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    const err = new Error("Audio file is not a valid WAV file.");
    err.statusCode = 400;
    throw err;
  }

  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    const err = new Error("Audio file is not a valid WAV file (missing RIFF/WAVE marker).");
    err.statusCode = 400;
    throw err;
  }

  let offset = 12;
  let fmt = null;
  let dataBytes = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (chunkId === "fmt " && body + 16 <= buffer.length) {
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        blockAlign: buffer.readUInt16LE(body + 12),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (chunkId === "data") {
      // Clamp to the real buffer length in case the header lies.
      dataBytes = Math.min(chunkSize, buffer.length - body);
    }

    // Chunks are word-aligned (padded to even length).
    offset = body + chunkSize + (chunkSize % 2);
  }

  if (!fmt) {
    const err = new Error("Audio file is missing its WAV format header.");
    err.statusCode = 400;
    throw err;
  }

  const bytesPerFrame = (fmt.bitsPerSample / 8) * fmt.channels || 1;
  const durationSeconds = dataBytes > 0 ? dataBytes / (fmt.sampleRate * bytesPerFrame) : 0;

  return { ...fmt, dataBytes, durationSeconds };
};

/**
 * Assert the clip matches the required capture format. `expected` defaults to
 * mono 16 kHz 16-bit PCM (see properties/config.js).
 */
const assertRecordingFormat = (buffer, expected = {}) => {
  const {
    sampleRate = 16000,
    bitDepth = 16,
    channels = 1,
  } = expected;

  const header = parseWavHeader(buffer);

  const problems = [];
  if (header.audioFormat !== 1) problems.push("must be uncompressed PCM");
  if (header.sampleRate !== sampleRate) problems.push(`sample rate must be ${sampleRate} Hz (got ${header.sampleRate})`);
  if (header.bitsPerSample !== bitDepth) problems.push(`bit depth must be ${bitDepth}-bit (got ${header.bitsPerSample})`);
  if (header.channels !== channels) problems.push(`must be ${channels === 1 ? "mono" : `${channels} channels`} (got ${header.channels})`);

  if (problems.length) {
    const err = new Error(`Recording format rejected: ${problems.join("; ")}.`);
    err.statusCode = 400;
    throw err;
  }

  return header;
};

module.exports = { parseWavHeader, assertRecordingFormat };
