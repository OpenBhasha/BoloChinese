const config = require("../properties/config");
const logger = require("../logging/logger");
const User = require("../modules/register/models/user.model");

const MIN_PASSWORD_LENGTH = 6;

/**
 * Seeds the first admin account from environment variables.
 *
 * Required env: ADMIN_EMAIL, ADMIN_PASSWORD (optional: ADMIN_NAME).
 *
 * The function is idempotent and safe to run on every boot:
 *  - it does nothing when the credentials are not configured;
 *  - it does nothing once any admin already exists;
 *  - it never overwrites an existing user or an existing password.
 *
 * @returns {Promise<{status: string, email?: string, reason?: string}>}
 */
const seedFirstAdmin = async () => {
  const { name, email, password } = config.admin;

  if (!email || !password) {
    return { status: "skipped", reason: "ADMIN_EMAIL / ADMIN_PASSWORD not configured" };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      status: "skipped",
      reason: `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }

  const existingAdmin = await User.findOne({ role: "admin" }).select("email");
  if (existingAdmin) {
    return { status: "exists", email: existingAdmin.email };
  }

  // No admin yet, but the address may already belong to a regular user.
  const existingUser = await User.findOne({ email }).select("email");
  if (existingUser) {
    return {
      status: "skipped",
      email,
      reason: "a non-admin user already uses ADMIN_EMAIL",
    };
  }

  try {
    // Password is hashed by the User model pre-save hook.
    const admin = await User.create({
      name,
      email,
      password,
      role: "admin",
      isVerified: true,
    });
    return { status: "created", email: admin.email };
  } catch (error) {
    // Two instances booting at once can race on the unique email index.
    if (error.code === 11000) {
      return { status: "exists", email };
    }
    throw error;
  }
};

/**
 * Startup wrapper: seeds the first admin and logs the outcome.
 * Never throws - a seeding problem must not stop the API from serving.
 */
const seedFirstAdminOnStartup = async () => {
  if (!config.admin.seedOnStartup) {
    logger.info("Admin seeding disabled (SEED_ADMIN=false)");
    return;
  }

  try {
    const result = await seedFirstAdmin();

    switch (result.status) {
      case "created":
        logger.info(`First admin seeded from environment: ${result.email}`);
        break;
      case "exists":
        logger.info(`Admin already present (${result.email}), skipping seeding`);
        break;
      default:
        logger.warn(`Admin seeding skipped: ${result.reason}`);
    }
  } catch (error) {
    logger.error(`Admin seeding failed: ${error.message}`);
  }
};

module.exports = { seedFirstAdmin, seedFirstAdminOnStartup, MIN_PASSWORD_LENGTH };
