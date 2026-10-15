import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// The backend's own upload validator, so encoder tests check the real contract
// rather than a second reading of the WAV spec. Its defaults are the same
// mono / 16 kHz / 16-bit values as backend/properties/config.js `audio`.
export const { parseWavHeader, assertRecordingFormat } = require("../../../backend/services/wav.js");
