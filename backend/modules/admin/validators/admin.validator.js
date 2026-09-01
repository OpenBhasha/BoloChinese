const { body, param } = require("express-validator");

// ─── Project Validators ───────────────────────────────────────────────────────

const createProjectValidator = [
  body("name")
    .trim()
    .notEmpty().withMessage("Project name is required")
    .isLength({ min: 2, max: 200 }).withMessage("Project name must be between 2 and 200 characters"),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage("Description must be at most 1000 characters"),
];

const updateProjectValidator = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 }).withMessage("Project name must be between 2 and 200 characters"),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage("Description must be at most 1000 characters"),
];

// ─── User Validators ──────────────────────────────────────────────────────────

const updateUserValidator = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage("Name must be between 2 and 100 characters"),

  body("email")
    .optional()
    .trim()
    .isEmail().withMessage("Please provide a valid email address")
    .normalizeEmail(),

  body("role")
    .optional()
    .isIn(["user", "admin"]).withMessage("Role must be either 'user' or 'admin'"),

  body("isVerified")
    .optional()
    .isBoolean().withMessage("isVerified must be a boolean"),
];

// ─── Task Validators ──────────────────────────────────────────────────────────

const createTaskValidator = [
  body("dialogueId")
    .trim()
    .notEmpty().withMessage("Dialogue ID is required")
    .isLength({ max: 200 }).withMessage("Dialogue ID must be at most 200 characters"),

  body("chineseTranscript")
    .trim()
    .notEmpty().withMessage("Chinese transcript is required")
    .isLength({ max: 20000 }).withMessage("Chinese transcript must be at most 20000 characters"),

  body("pinyin")
    .trim()
    .notEmpty().withMessage("Pinyin is required")
    .isLength({ max: 20000 }).withMessage("Pinyin must be at most 20000 characters"),

  body("assignedTo")
    .optional({ checkFalsy: true })
    .isMongoId().withMessage("assignedTo must be a valid user ID"),
];

const updateTaskValidator = [
  body("dialogueId")
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage("Dialogue ID must be at most 200 characters"),

  body("chineseTranscript")
    .optional()
    .trim()
    .isLength({ max: 20000 }).withMessage("Chinese transcript must be at most 20000 characters"),

  body("pinyin")
    .optional()
    .trim()
    .isLength({ max: 20000 }).withMessage("Pinyin must be at most 20000 characters"),

  body("assignedTo")
    .optional({ checkFalsy: true })
    .isMongoId().withMessage("assignedTo must be a valid user ID"),
];

module.exports = {
  createProjectValidator,
  updateProjectValidator,
  updateUserValidator,
  createTaskValidator,
  updateTaskValidator,
};
