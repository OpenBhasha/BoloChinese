// Builds a RIFF/WAVE buffer of silence. Defaults match properties/config.js
// `audio`; override any field to produce a deliberately non-conforming clip.
export const buildWav = ({
  sampleRate = 16000,
  bitDepth = 16,
  channels = 1,
  durationSeconds = 1,
  audioFormat = 1,
} = {}) => {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = bytesPerSample * channels;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = Math.round(sampleRate * durationSeconds) * blockAlign;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");

  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(audioFormat, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);

  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);

  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
};
