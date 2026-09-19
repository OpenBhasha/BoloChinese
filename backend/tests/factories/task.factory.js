import { Task } from "../helpers/models.js";
import { nextSequence } from "./sequence.js";
import { createProject } from "./project.factory.js";

export const taskAttrs = (overrides = {}) => {
  const n = nextSequence();

  return {
    dialogueId: `DLG-${String(n).padStart(4, "0")}`,
    chineseTranscript: "你好，今天天气很好。",
    pinyin: "nǐ hǎo, jīn tiān tiān qì hěn hǎo.",
    ...overrides,
  };
};

// Saved through create() rather than insertMany() so the pre-save hook assigns
// a real TASK-NNNN id, matching how the admin API creates tasks.
export const createTask = async (overrides = {}) => {
  const projectId = overrides.projectId ?? (await createProject())._id;
  const { dialogueId, chineseTranscript, pinyin } = taskAttrs(overrides);

  return Task.create({
    projectId,
    dialogueId,
    chineseTranscript,
    pinyin,
    assignedTo: overrides.assignedTo ?? null,
  });
};
