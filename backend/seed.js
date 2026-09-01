require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./database/connection");
const config = require("./properties/config");
const { seedFirstAdmin, MIN_PASSWORD_LENGTH } = require("./startup/seedAdmin");

/**
 * Manual seeding entry point (`npm run seed`).
 *
 * The server already seeds the first admin on boot; this script is for
 * seeding without starting the API (one-off jobs, local setup, CI).
 * Credentials come from the environment: ADMIN_EMAIL, ADMIN_PASSWORD
 * and the optional ADMIN_NAME.
 */
const seed = async () => {
  try {
    if (!config.admin.email || !config.admin.password) {
      console.error("\n❌  ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment.");
      console.error("   Example:\n     ADMIN_EMAIL=admin@example.com");
      console.error("     ADMIN_PASSWORD=a-strong-password\n");
      process.exit(1);
    }

    if (config.admin.password.length < MIN_PASSWORD_LENGTH) {
      console.error(
        `\n❌  ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.\n`
      );
      process.exit(1);
    }

    await connectDB();
    const result = await seedFirstAdmin();

    if (result.status === "created") {
      console.log("\n✅  Admin seeded successfully!");
      console.log("─────────────────────────────────────");
      console.log(`   Name     : ${config.admin.name}`);
      console.log(`   Email    : ${result.email}`);
      console.log("   Password : (from ADMIN_PASSWORD)  ← change this after login");
      console.log("─────────────────────────────────────\n");
    } else if (result.status === "exists") {
      console.log(`\n⚠️  An admin already exists: ${result.email}`);
      console.log("   Delete the document from MongoDB and re-run if you need to reset.\n");
    } else {
      console.log(`\n⚠️  Seeding skipped: ${result.reason}\n`);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("\n❌  Seeding failed:", err.message);
    process.exit(1);
  }
};

seed();
