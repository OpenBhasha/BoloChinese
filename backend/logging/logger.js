const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const path = require("path");

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return stack
      ? `[${timestamp}] ${level.toUpperCase()}: ${message}\n${stack}`
      : `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  })
);

// Under `NODE_ENV=test` the logger is silenced and the rotating file transport
// is left off entirely: the suite runs hundreds of requests, and neither the
// console noise nor a day's worth of rotated log files is useful there.
const isTest = process.env.NODE_ENV === "test";

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(winston.format.colorize(), logFormat),
  }),
];

if (!isTest) {
  transports.push(
    new DailyRotateFile({
      filename: path.join(__dirname, "../logs/app-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
    })
  );
}

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "warn" : "debug",
  silent: isTest,
  format: logFormat,
  transports,
});

module.exports = logger;
