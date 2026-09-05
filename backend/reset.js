/**
 * Full reset - drops every collection in the configured MongoDB database AND
 * removes every uploaded Cloudinary audio under the `bolo/audio/` prefix.
 *
 * Usage:
 *   npm run reset            (interactive - asks you to confirm)
 *   RESET_YES=1 npm run reset (non-interactive - use in scripts / CI)
 *
 * Safety:
 *   - Reads MONGODB_URI + CLOUDINARY_* from backend/.env
 *   - Refuses to run against a URI containing "prod" unless you type it back
 *   - Prints the exact database name and Cloudinary cloud it will touch
 *   - Prompts once before touching anything (unless RESET_YES=1)
 *
 * After running, boot the backend (`npm run dev`) - the SEED_ADMIN flow
 * will recreate the admin from ADMIN_EMAIL / ADMIN_PASSWORD.
 */
require("dotenv").config();
const readline = require("readline");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const config = require("./properties/config");

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

const wipeCloudinary = async () => {
  const { cloudName, apiKey, apiSecret } = config.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    console.log(`\n  Cloudinary: skipped (no credentials configured).`);
    return;
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  console.log(`\n  Cloudinary: deleting resources under prefix "bolo/audio/" on cloud "${cloudName}"…`);

  // Audio uploads use resource_type "video" (per services/cloudinary.service.js).
  // The bulk API deletes up to 100 resources per call.
  let cursor;
  let totalDeleted = 0;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await cloudinary.api.resources({
      type: "upload",
      resource_type: "video",
      prefix: "bolo/audio/",
      max_results: 100,
      next_cursor: cursor,
    });
    const ids = (page.resources || []).map((r) => r.public_id);
    if (ids.length) {
      // eslint-disable-next-line no-await-in-loop
      const res = await cloudinary.api.delete_resources(ids, { resource_type: "video", invalidate: true });
      const deleted = Object.values(res.deleted || {}).filter((s) => s === "deleted").length;
      totalDeleted += deleted;
      console.log(`    - deleted ${deleted}/${ids.length} in this page`);
    }
    cursor = page.next_cursor;
  } while (cursor);

  // Also try to delete the empty folder itself so it doesn't linger in the
  // console. Errors here are non-fatal (folder API needs Admin access).
  await cloudinary.api.delete_folder("bolo/audio").catch(() => {});
  await cloudinary.api.delete_folder("bolo").catch(() => {});

  console.log(`  Cloudinary: done. Removed ${totalDeleted} resource(s).`);
};

(async () => {
  const dbName = parseDbNameFromUri(config.mongoUri);
  console.log(`
  ── RESET SUMMARY ──────────────────────────────────────────────
  MongoDB URI  : ${config.mongoUri.replace(/:(?:[^@/]+)@/, ":***@")}
  Database     : ${dbName}
  Cloudinary   : ${config.cloudinary.cloudName || "(not configured)"}
  Audio prefix : bolo/audio/
  ──────────────────────────────────────────────────────────────

  This drops every collection in the database above AND deletes every
  Cloudinary audio under the "bolo/audio/" prefix. No undo.
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
    await wipeCloudinary();
    console.log("\n  All done. Boot the backend to re-seed the admin.\n");
    process.exit(0);
  } catch (err) {
    console.error(`\n  RESET FAILED: ${err.message}`);
    process.exit(1);
  }
})();
