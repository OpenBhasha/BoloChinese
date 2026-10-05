import { nextSequence } from "./sequence.js";

export const audio = (overrides = {}) => ({
  provider: "cloudinary",
  publicId: "bolo/audio/fixture",
  url: "https://res.cloudinary.test/bolo/audio/fixture.wav",
  contentType: "audio/wav",
  sampleRate: 16000,
  bitDepth: 16,
  channels: 1,
  durationSeconds: 2,
  fileSizeBytes: 64044,
  uploadedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

export const task = (overrides = {}) => {
  const n = nextSequence();

  return {
    _id: `task-${n}`,
    taskId: `TASK-${String(n).padStart(4, "0")}`,
    dialogueId: `DLG-${String(n).padStart(4, "0")}`,
    chineseTranscript: "你好，今天天气很好。",
    pinyin: "nǐ hǎo, jīn tiān tiān qì hěn hǎo.",
    status: "pending",
    pinyinVerified: null,
    correctedChineseTranscript: "",
    correctedPinyin: "",
    isCorrected: false,
    editCharCount: 0,
    discarded: { flagged: false, discardedAt: null },
    audio: null,
    ...overrides,
  };
};

export const completedTask = (overrides = {}) =>
  task({ status: "completed", pinyinVerified: true, audio: audio(), ...overrides });
