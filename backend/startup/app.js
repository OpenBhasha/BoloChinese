const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const path = require("path");
const logger = require("../logging/logger");
const modulesRouter = require("../modules/index");
const errorHandler = require("../middlewares/errorHandler");

const createApp = () => {
  const app = express();

  // Security
  app.use(helmet());

  // Gzip / brotli JSON responses - typically 70-90% smaller for our task lists,
  // exports, and dashboard payloads. Skipped for tiny bodies (< 1 KB) and for
  // clients that already set a compression header or Cache-Control: no-transform.
  app.use(compression({ threshold: 1024 }));

  // CORS
  app.use(cors());

  // Body parsers - increase limit for audio metadata
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // HTTP request logger (every API hit)
  const morganStream = { write: (message) => logger.http(message.trim()) };
  app.use(
    morgan(":method :url :status :res[content-length] - :response-time ms", {
      stream: morganStream,
    })
  );

  // Serve static files (templates, etc.)
  const publicDir = path.join(__dirname, "..", "public");
  app.use("/api/public", express.static(publicDir));
  app.use("/public", express.static(publicDir));

  // Health check
  app.get("/health", (req, res) => {
    res.json({ success: true, message: "Bolo API is running", timestamp: new Date().toISOString() });
  });

  // All API routes
  app.use("/api", modulesRouter);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route ${req.method} ${req.url} not found` });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
