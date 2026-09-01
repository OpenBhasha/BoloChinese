require("dotenv").config();

const config = {
  port: process.env.PORT || 5000,
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/bolochinese",
  jwtSecret: process.env.JWT_SECRET || "default_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  nodeEnv: process.env.NODE_ENV || "development",

  // First (bootstrap) admin, seeded from the environment on startup.
  // Leave ADMIN_EMAIL / ADMIN_PASSWORD unset to disable seeding entirely.
  admin: {
    name: process.env.ADMIN_NAME || "Super Admin",
    email: (process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || "",
    // Set SEED_ADMIN=false to keep the credentials configured but skip the
    // automatic seeding that runs when the server boots.
    seedOnStartup: String(process.env.SEED_ADMIN || "true").toLowerCase() !== "false",
  },

  audio: {
    sampleRate: 16000,
    bitDepth: 16,
    channels: 1,
    format: "audio/wav",
    maxSizeMB: 50,
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
};

module.exports = config;
