import { MongoDBContainer } from "@testcontainers/mongodb";

// Pinned rather than `:latest` so an upstream release cannot change test
// behaviour without a deliberate bump. Keep in step with the deployed server.
const MONGO_IMAGE = process.env.TEST_MONGO_IMAGE || "mongo:7.0";

let container;

export async function setup({ provide }) {
  container = await new MongoDBContainer(MONGO_IMAGE).start();

  // The container always boots a single-node replica set, and the set
  // advertises its internal hostname - which the host cannot resolve.
  // `directConnection` tells the driver to use the mapped port instead.
  const uri = `${container.getConnectionString()}/?directConnection=true`;

  provide("mongoUri", uri);
}

export async function teardown() {
  await container?.stop();
}
