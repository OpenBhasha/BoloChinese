/**
 * Full reset - drops every collection in the configured MongoDB database AND
 * removes every locally-stored audio file under backend/uploads/audio.
 *
 * Usage:
 *   npm run reset            (interactive - asks you to confirm)
 *   RESET_YES=1 npm run reset (non-interactive - use in scripts / CI)
 *
 * Safety:
 *   - Reads MONGODB_URI from backend/.env
 *   - Refuses to run against a URI containing "prod" unless you type it back
 *   - Prints the exact database name it will drop
 *   - Prompts once before touching anything (unless RESET_YES=1)
 *
 * After running, boot the backend (`npm run dev`) - the SEED_ADMIN flow
 * will recreate the admin from ADMIN_EMAIL / ADMIN_PASSWORD.
 */
require("dotenv").config();
const readline = require("readline");
const mongoose = require("mongoose");
const config = require("./properties/config");
const audioStorage = require("./services/audioStorage.service");

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

const parseDbNameFromUri = (uri) => {
  try {
    // e.g. mongodb://host:port/dbname?...  OR  mongodb+srv://host/dbname?...
    const withoutQuery = uri.split("?")[0];
    const parts = withoutQuery.split("/");
    return parts[parts.length - 1] || "(default)";
  } catch {
    return "(unknown)";
  }
};

const wipeMongo = async () => {
  await mongoose.connect(config.mongoUri);
  const dbName = mongoose.connection.name;
  const collections = await mongoose.connection.db.collections();
  console.log(`\n  MongoDB: dropping ${collections.length} collection(s) in "${dbName}"…`);
  for (const c of collections) {
    // eslint-disable-next-line no-await-in-loop
    await c.drop().catch((e) => {
      if (e.codeName === "NamespaceNotFound") return;
      throw e;
    });
    console.log(`    - dropped ${c.collectionName}`);
  }
  await mongoose.disconnect();
  console.log(`  MongoDB: done.`);
};

const wipeLocalAudio = async () => {
  console.log(`\n  Local audio: clearing ${audioStorage.UPLOAD_ROOT}…`);
  await audioStorage.clearAllAudio();
  console.log(`  Local audio: done.`);
};

(async () => {
  const dbName = parseDbNameFromUri(config.mongoUri);
  console.log(`
  ── RESET SUMMARY ──────────────────────────────────────────────
  MongoDB URI   : ${config.mongoUri.replace(/:(?:[^@/]+)@/, ":***@")}
  Database      : ${dbName}
  Audio storage : ${audioStorage.UPLOAD_ROOT}
  ──────────────────────────────────────────────────────────────

  This drops every collection in the database above AND removes every
  audio file under the local uploads directory. No undo.
`);

  if (/prod/i.test(config.mongoUri)) {
    const check = await ask(`  Your MONGODB_URI looks like a production one.\n  Type the database name (${dbName}) to continue: `);
    if (check !== dbName) {
      console.log("  Aborted.");
      process.exit(1);
    }
  }

  if (!process.env.RESET_YES) {
    const answer = await ask("  Type YES to proceed, anything else to abort: ");
    if (answer !== "YES") {
      console.log("  Aborted.");
      process.exit(0);
    }
  }

  try {
    await wipeMongo();
    await wipeLocalAudio();
    console.log("\n  All done. Boot the backend to re-seed the admin.\n");
    process.exit(0);
  } catch (err) {
    console.error(`\n  RESET FAILED: ${err.message}`);
    process.exit(1);
  }
})();
