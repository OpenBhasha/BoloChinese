const jwt = require("jsonwebtoken");
const { findUserByEmailForLogin } = require("../dao/login.dao");
const config = require("../../../properties/config");
const logger = require("../../../logging/logger");

const loginUser = async ({ email, password }) => {
  const user = await findUserByEmailForLogin(email);

  if (!user) {
    const err = new Error("Invalid email or password.");
    err.statusCode = 401;
    throw err;
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    logger.warn(`Failed login attempt for email: ${email}`);
    const err = new Error("Invalid email or password.");
    err.statusCode = 401;
    throw err;
  }

  // Soft-deleted accounts don't need a check here - findUserByEmailForLogin
  // already filters them out (deletedAt is null-only), so the branch above
  // returns "Invalid email or password" without leaking that the address was
  // once real. A new sign-up may reuse a deleted address; the partial unique
  // index guarantees at most one active user per email.

  if (!user.isVerified) {
    const err = new Error("Your account is pending admin verification.");
    err.statusCode = 403;
    throw err;
  }

  const payload = { id: user._id, role: user.role, email: user.email };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

  logger.info(`User logged in: ${user.email} (role: ${user.role})`);

  return {
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
    },
  };
};

module.exports = { loginUser };
