const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const logger = require("../logging/logger");
const config = require("../properties/config");
const modulesRouter = require("../modules/index");
const errorHandler = require("../middlewares/errorHandler");

const createApp = () => {
  const app = express();

  // Security
  app.use(helmet());

  // CORS — open by default; set CORS_ORIGIN to restrict to known frontends
  const allowedOrigins = config.corsOrigins;
  if (allowedOrigins.length > 0) {
    logger.info(`CORS restricted to: ${allowedOrigins.join(", ")}`);
    app.use(
      cors({
        origin: (origin, callback) => {
          // No Origin header: same-origin, curl, health checks — always allowed.
          if (!origin || allowedOrigins.includes(origin.replace(/\/+$/, ""))) {
            return callback(null, true);
          }
          // Omit the CORS headers rather than throwing: the browser blocks the
          // response on its own, and the server avoids a 500 per request.
          logger.warn(`Blocked CORS request from origin: ${origin}`);
          return callback(null, false);
        },
      })
    );
  } else {
    app.use(cors());
  }

  // Body parsers — increase limit for audio metadata
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
    res.json({ success: true, message: "BoloChinese API is running", timestamp: new Date().toISOString() });
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
