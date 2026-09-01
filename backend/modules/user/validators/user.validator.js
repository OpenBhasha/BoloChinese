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

const markErroneousValidator = [
  body("reason")
    .trim()
    .notEmpty().withMessage("A reason is required to mark this item erroneous")
    .isLength({ max: 1000 }).withMessage("Reason must be at most 1000 characters"),
];

module.exports = { verifyPinyinValidator, correctTranscriptValidator, markErroneousValidator };
