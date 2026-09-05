require("dotenv").config();
const createApp = require("./startup/app");
const connectDB = require("./database/connection");
const config = require("./properties/config");
const logger = require("./logging/logger");
const { seedFirstAdminOnStartup } = require("./startup/seedAdmin");
const User = require("./modules/register/models/user.model");

const startServer = async () => {
  try {
    // Connect to MongoDB first
    await connectDB();

    // Reconcile the User indexes with the schema. Needed so the old plain-
    // unique indexes on email / phone / username get dropped and replaced
    // with the partial ones that only enforce uniqueness among active users.
    try {
      await User.syncIndexes();
      logger.info("User indexes synced.");
    } catch (idxErr) {
      logger.warn(`User.syncIndexes failed: ${idxErr.message}`);
    }

    // Bootstrap the first admin from ADMIN_EMAIL / ADMIN_PASSWORD (idempotent)
    await seedFirstAdminOnStartup();

    const app = createApp();

    app.listen(config.port, () => {
      logger.info(`====================================================`);
      logger.info(`  Bolo API Server`);
      logger.info(`  ENV   : ${config.nodeEnv}`);
      logger.info(`  PORT  : ${config.port}`);
      logger.info(`  BASE  : http://localhost:${config.port}/api`);
      logger.info(`====================================================`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
