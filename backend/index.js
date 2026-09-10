require("dotenv").config();
const createApp = require("./startup/app");
const connectDB = require("./database/connection");
const config = require("./properties/config");
const logger = require("./logging/logger");
const { seedFirstAdminOnStartup } = require("./startup/seedAdmin");
const User = require("./modules/register/models/user.model");
const Project = require("./modules/admin/models/project.model");
const Task = require("./modules/admin/models/task.model");
const ProjectAssignment = require("./modules/admin/models/projectAssignment.model");
const TaskSubmission = require("./modules/admin/models/taskSubmission.model");
const UserProgress = require("./modules/admin/models/userProgress.model");

const startServer = async () => {
  try {
    // Connect to MongoDB first
    await connectDB();

    // Reconcile every collection's indexes with its schema on boot. For User
    // this drops the old plain-unique indexes on email / phone / username in
    // favour of the partial ones. For the rest it guarantees the compound
    // indexes the paginated list queries rely on actually exist in prod
    // (Mongoose autoIndex is often off there).
    const indexed = { User, Project, Task, ProjectAssignment, TaskSubmission, UserProgress };
    await Promise.all(
      Object.entries(indexed).map(([name, model]) =>
        model.syncIndexes().catch((idxErr) => {
          logger.warn(`${name}.syncIndexes failed: ${idxErr.message}`);
        })
      )
    );
    logger.info("Indexes synced.");

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
