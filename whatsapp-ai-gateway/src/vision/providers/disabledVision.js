/**
 * disabledVision.js — Disabled Vision Provider
 *
 * Used when vision review is disabled or unavailable.
 * Always returns not-available, causing the pipeline to fall back
 * to memory/manual flow without crashing.
 */

async function reviewField() {
    return { available: false, reason: "Vision review disabled" };
}

async function isAvailable() {
    return false;
}

module.exports = { reviewField, isAvailable };
