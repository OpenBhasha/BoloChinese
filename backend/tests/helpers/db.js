import mongoose from "mongoose";
import { models } from "./models.js";

// Every worker connects to the same container but to its own database, so
// test files running in parallel cannot observe each other's writes.
const workerDbName = () => `bolo_test_w${process.env.VITEST_WORKER_ID || "1"}`;

export const connectTestDb = async (uri) => {
  if (!uri) {
    throw new Error(
      "No MongoDB URI was provided to the test suite. tests/setup/global-setup.js should have started the container and provided `mongoUri`."
    );
  }

  await mongoose.connect(uri, { dbName: workerDbName() });
  return mongoose.connection;
};

export const disconnectTestDb = async () => {
  await mongoose.disconnect();
};

// Mirrors index.js on boot. Behaviours like the partial unique indexes on
// email/phone/username only exist once the index is actually built, so a suite
// that skipped this would silently stop testing them.
export const syncModelIndexes = async () => {
  await Promise.all(Object.values(models).map((model) => model.syncIndexes()));
};

// Empties every collection but leaves the indexes in place - dropping the
// database instead would mean rebuilding them after every test.
export const clearCollections = async () => {
  const collections = await mongoose.connection.db.listCollections().toArray();

  await Promise.all(
    collections
      .filter(({ name }) => !name.startsWith("system."))
      .map(({ name }) => mongoose.connection.db.collection(name).deleteMany({}))
  );
};
