// Test-only environment. Runs as the first setup file, before anything imports
// properties/config.js. These also shadow the developer's local `.env`,
// because dotenv never overwrites a variable that is already set.

process.env.NODE_ENV = "test";
process.env.PORT = "0";

// The real URI is injected per worker in mongo.js. This placeholder only
// ensures a stray connectDB() can never reach a developer's own MongoDB.
process.env.MONGODB_URI = "mongodb://127.0.0.1:1/bolo-test-placeholder";
process.env.MONGO_URI = process.env.MONGODB_URI;

process.env.JWT_SECRET = "test-only-jwt-secret-not-used-anywhere-real";
process.env.JWT_EXPIRES_IN = "1h";

// Tests build the admins they need through the factories.
process.env.SEED_ADMIN = "false";
process.env.ADMIN_NAME = "Test Admin";
process.env.ADMIN_EMAIL = "";
process.env.ADMIN_PASSWORD = "";

// Cloudinary is faked in fakes.js; these exist only so a test that somehow
// reached the real service fails on an assertion, not a confusing 500.
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
