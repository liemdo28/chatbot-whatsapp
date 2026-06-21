const winston = require("winston");
const path = require("path");
require("dotenv").config();

const logDir = process.env.LOG_DIR || "./logs";

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
            return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({
            filename: path.join(logDir, "gateway.log"),
            maxsize: 5242880,
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join(logDir, "error.log"),
            level: "error",
            maxsize: 5242880,
            maxFiles: 3,
        }),
    ],
});

module.exports = logger;
