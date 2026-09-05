const User = require("../models/user.model");

const createUser = async (userData) => {
  const user = new User(userData);
  return user.save();
};

// Register-time lookups skip soft-deleted accounts so a deleted user's
// email / phone / username can be reused by a fresh sign-up.
const findUserByEmail = async (email) => {
  return User.findOne({ email, deletedAt: null }).select("+password");
};

const findUserById = async (id) => {
  return User.findById(id);
};

const findUserByUsername = async (username) => {
  return User.findOne({ username, deletedAt: null });
};

const findUserByPhone = async (phone) => {
  return User.findOne({ phone, deletedAt: null });
};

module.exports = { createUser, findUserByEmail, findUserById, findUserByUsername, findUserByPhone };
