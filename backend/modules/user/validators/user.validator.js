const { body } = require("express-validator");

const verifyPinyinValidator = [
  body("correct")
    .isBoolean().withMessage("correct must be a boolean"),
];

const correctTranscriptValidator = [
  body("correctedChineseTranscript")
    .trim()
    .notEmpty().withMessage("Corrected Chinese transcript is required")
    .isLength({ max: 20000 }).withMessage("Corrected transcript must be at most 20000 characters"),

  body("correctedPinyin")
    .trim()
    .notEmpty().withMessage("Corrected Pinyin is required")
    .isLength({ max: 20000 }).withMessage("Corrected pinyin must be at most 20000 characters"),
];

module.exports = { verifyPinyinValidator, correctTranscriptValidator };
