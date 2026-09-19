import { afterAll, afterEach, beforeAll, inject } from "vitest";
import { clearCollections, connectTestDb, disconnectTestDb, syncModelIndexes } from "../helpers/db.js";

// Registered centrally rather than per test file, so no test can forget to
// clean up after itself and leave the suite order-dependent.
beforeAll(async () => {
  await connectTestDb(inject("mongoUri"));
  await syncModelIndexes();
  await clearCollections();
});

afterEach(async () => {
  await clearCollections();
});

afterAll(async () => {
  await disconnectTestDb();
});
