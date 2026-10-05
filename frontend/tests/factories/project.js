import { nextSequence } from "./sequence.js";

export const projectStats = (overrides = {}) => ({
  total: 0,
  completed: 0,
  edited: 0,
  inProgress: 0,
  discarded: 0,
  pending: 0,
  ...overrides,
});

export const project = (overrides = {}) => {
  const n = nextSequence();

  return {
    _id: `project-${n}`,
    name: `Test Project ${n}`,
    description: `Fixture project ${n}`,
    taskCount: 0,
    ...overrides,
    stats: projectStats(overrides.stats),
  };
};
