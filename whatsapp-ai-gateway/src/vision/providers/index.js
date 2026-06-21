/**
 * Vision Provider Abstraction — Phase 6
 *
 * Resolves the active vision provider based on environment config.
 * Supports: openai, disabled
 * Future: local model
 */

const logger = require("../../logger");

const VISION_REVIEW_ENABLED = String(process.env.VISION_REVIEW_ENABLED || "false").toLowerCase() === "true";
const VISION_PROVIDER = (process.env.VISION_PROVIDER || "disabled").toLowerCase();

let activeProvider = null;

function getProvider() {
    // CTO DIRECTIVE: Re-read env at call time (not module load time)
    // to ensure config loaded by dotenv is picked up.
    const enabled = String(process.env.VISION_REVIEW_ENABLED || "false").toLowerCase() === "true";
    const provider = (process.env.VISION_PROVIDER || "disabled").toLowerCase();

    if (!enabled) {
        if (activeProvider) return activeProvider;
        logger.info("[VisionProvider] Vision review disabled via config");
        activeProvider = require("./disabledVision");
        return activeProvider;
    }

    switch (provider) {
        case "openai": {
            const openai = require("./openaiVision");
            logger.info("[VisionProvider] Using OpenAI Vision provider");
            activeProvider = openai;
            break;
        }
        default: {
            logger.info("[VisionProvider] Unknown provider, using disabled mode", { provider: VISION_PROVIDER });
            activeProvider = require("./disabledVision");
            break;
        }
    }

    return activeProvider;
}

function resetProvider() {
    activeProvider = null;
}

module.exports = { getProvider, resetProvider, VISION_REVIEW_ENABLED, VISION_PROVIDER };
