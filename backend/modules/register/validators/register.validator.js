const { body } = require("express-validator");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const registerValidator = [
  body("name")
    .trim()
    .notEmpty().withMessage("Name is required")
    .isLength({ min: 2, max: 100 }).withMessage("Name must be between 2 and 100 characters")
    .matches(/^[a-zA-Z\s'-]+$/).withMessage("Name can only contain letters, spaces, hyphens, and apostrophes"),

  body("email")
    .trim()
    .notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Please provide a valid email address")
    .normalizeEmail(),

  // Phone is required so every account has a corroborating identifier - it's
  // what makes duplicate-account and anonymous-account detection possible.
  body("phone")
    .trim()
    .notEmpty().withMessage("Phone number is required")
    .isLength({ max: 30 }).withMessage("Phone number is too long")
    .custom((value) => {
      const parsed = parsePhoneNumberFromString(value);
      if (!parsed || !parsed.isValid()) {
        throw new Error("Please provide a valid phone number in international format, e.g. +14155552671");
      }
      return true;
    })
    // Normalize to E.164 so the same number always dedupes to one value
    // regardless of spacing/punctuation used at input time.
    .customSanitizer((value) => {
      const parsed = parsePhoneNumberFromString(value);
      return parsed && parsed.isValid() ? parsed.number : value;
    }),

  body("password")
    .notEmpty().withMessage("Password is required")
    .isLength({ min: 6 }).withMessage("Password must be at least 6 characters")
    .matches(/[A-Z]/).withMessage("Password must contain at least one uppercase letter")
    .matches(/[0-9]/).withMessage("Password must contain at least one number"),
];

module.exports = { registerValidator };
