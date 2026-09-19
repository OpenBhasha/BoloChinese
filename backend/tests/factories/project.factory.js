import { Project } from "../helpers/models.js";
import { nextSequence } from "./sequence.js";
import { createAdmin } from "./user.factory.js";

export const projectAttrs = (overrides = {}) => {
  const n = nextSequence();

  return {
    name: `Test Project ${n}`,
    description: `Fixture project ${n}`,
    ...overrides,
  };
};

// Mints a creator when the caller does not supply one - a test about tasks
// should not have to care who owns the project they hang off.
export const createProject = async (overrides = {}) => {
  const createdBy = overrides.createdBy ?? (await createAdmin())._id;
  const { name, description } = projectAttrs(overrides);

  return Project.create({ name, description, createdBy, tasks: overrides.tasks ?? [] });
};
