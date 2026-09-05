const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name must be at most 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
    },
    // Stored normalized to E.164 by the register validator. Required for
    // public registration (enforced there, not here, since internal flows
    // like admin seeding create users without a phone). Unique + sparse so
    // the same number can't back two accounts, while users with no phone
    // (e.g. seeded admins) don't collide with each other.
    phone: {
      type: String,
      trim: true,
      maxlength: [30, "Phone number must be at most 30 characters"],
      unique: true,
      sparse: true,
    },
    // Auto-generated from the user's name at registration; unique across users.
    username: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    // Set when the name/identity supplied at registration looks anonymous or
    // invalid, so an admin can scrutinise it before approving the account.
    identityFlagged: {
      type: Boolean,
      default: false,
    },
    identityFlagReason: {
      type: String,
      trim: true,
      default: "",
    },
    // The personal project auto-created for this annotator once an admin
    // approves the account (named after the username).
    dedicatedProjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },
    role: {
      type: String,
      enum: {
        values: ["user", "admin"],
        message: "Role must be either 'user' or 'admin'",
      },
      required: [true, "Role is required"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // Never return password in queries
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Admin listings frequently split by role (user vs admin) and verified status.
userSchema.index({ role: 1, isVerified: 1 });

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
