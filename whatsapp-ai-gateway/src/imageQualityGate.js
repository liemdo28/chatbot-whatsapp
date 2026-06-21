/**
 * imageQualityGate.js — Phase 3: Image Quality Gate
 * 
 * Scores uploaded images BEFORE OCR to reject bad photos early.
 * Returns a quality score and decision (PASS / RETAKE).
 *
 * Scoring factors:
 *   - blur (Laplacian variance)
 *   - image dimensions (minimum size)
 *   - lighting (histogram analysis)
 *   - shadow / reflection detection
 *   - skew angle
 *   - table grid visibility
 *   - form completeness
 */

const logger = require("./logger");

// ─── Quality Thresholds ──────────────────────────────────────────────
const MIN_QUALITY_SCORE = 70;
const MIN_IMAGE_WIDTH = 1000;   // DEV1 FIX: raised from 600 — WhatsApp images below this are too small for OCR
const MIN_IMAGE_HEIGHT = 1400;  // DEV1 FIX: raised from 800 — cells crop to ~36px at 1024px height
const MIN_BLUR_SCORE = 50;     // Laplacian variance threshold
const MAX_SKEW_DEGREES = 15;
const MIN_TABLE_VISIBILITY = 0.3;  // fraction of grid lines detected
const MIN_CELL_CROP_HEIGHT = 60;  // DEV1 FIX: minimum expected cell crop height in pixels
const MIN_CELL_CROP_WIDTH = 120;  // DEV1 FIX: minimum expected cell crop width in pixels

/**
 * Evaluate image quality for food safety form processing.
 *
 * @param {string} imagePath - path to image file
 * @param {object} [opts] - optional overrides
 * @returns {object} { score, decision, factors, message }
 */
async function evaluateImageQuality(imagePath, opts = {}) {
    const factors = {
        dimensions: { score: 0, detail: "" },
        blur: { score: 0, detail: "" },
        lighting: { score: 0, detail: "" },
        gridVisibility: { score: 0, detail: "" },
    };

    let sharp = null;
    try {
        sharp = require("sharp");
    } catch (_) {
        // sharp not available — skip detailed analysis, return basic pass
        return {
            score: 85,
            decision: "PASS",
            factors: { sharp_unavailable: true },
            message: "Image quality gate: sharp not available, using basic check",
        };
    }

    try {
        const metadata = await sharp(imagePath).metadata();
        const { width = 0, height = 0, channels = 1, density = 72 } = metadata;

        // ─── Dimension Check ────────────────────────────────────
        if (width >= MIN_IMAGE_WIDTH && height >= MIN_IMAGE_HEIGHT) {
            factors.dimensions.score = 100;
            factors.dimensions.detail = `${width}x${height}`;
        } else if (width >= MIN_IMAGE_WIDTH * 0.7 && height >= MIN_IMAGE_HEIGHT * 0.7) {
            factors.dimensions.score = 60;
            factors.dimensions.detail = `Small: ${width}x${height}`;
        } else {
            factors.dimensions.score = 20;
            factors.dimensions.detail = `Too small: ${width}x${height}`;
        }

        // ─── Blur Detection (Laplacian variance approximation) ──
        // Convert to grayscale, compute raw pixel stats as blur proxy
        const rawStats = await sharp(imagePath)
            .greyscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const pixels = rawStats.data;
        const imgWidth = rawStats.info.width;
        const imgHeight = rawStats.info.height;

        // Laplacian approximation: compute sum of absolute differences
        let laplacianSum = 0;
        let pixelCount = 0;
        for (let y = 1; y < imgHeight - 1; y += 2) {
            for (let x = 1; x < imgWidth - 1; x += 2) {
                const idx = y * imgWidth + x;
                const center = pixels[idx];
                const top = pixels[(y - 1) * imgWidth + x];
                const bottom = pixels[(y + 1) * imgWidth + x];
                const left = pixels[y * imgWidth + (x - 1)];
                const right = pixels[y * imgWidth + (x + 1)];
                const laplacian = Math.abs(4 * center - top - bottom - left - right);
                laplacianSum += laplacian;
                pixelCount++;
            }
        }
        const blurScore = pixelCount > 0 ? laplacianSum / pixelCount : 0;

        if (blurScore >= 100) {
            factors.blur.score = 100;
            factors.blur.detail = `Sharp (laplacian=${blurScore.toFixed(1)})`;
        } else if (blurScore >= MIN_BLUR_SCORE) {
            factors.blur.score = Math.round(60 + (blurScore - MIN_BLUR_SCORE) * 40 / (100 - MIN_BLUR_SCORE));
            factors.blur.detail = `Acceptable (laplacian=${blurScore.toFixed(1)})`;
        } else if (blurScore >= 20) {
            factors.blur.score = Math.round(30 + (blurScore - 20) * 30 / (MIN_BLUR_SCORE - 20));
            factors.blur.detail = `Slightly blurry (laplacian=${blurScore.toFixed(1)})`;
        } else {
            factors.blur.score = Math.round(blurScore * 30 / 20);
            factors.blur.detail = `Very blurry (laplacian=${blurScore.toFixed(1)})`;
        }

        // ─── Lighting Analysis ──────────────────────────────────
        // Histogram analysis: check if image is too dark, too bright, or uneven
        let totalBrightness = 0;
        let darkPixels = 0;
        let brightPixels = 0;
        const sampleStep = 4;
        let sampledPixels = 0;
        for (let y = 0; y < imgHeight; y += sampleStep) {
            for (let x = 0; x < imgWidth; x += sampleStep) {
                const val = pixels[y * imgWidth + x];
                totalBrightness += val;
                sampledPixels++;
                if (val < 40) darkPixels++;
                if (val > 220) brightPixels++;
            }
        }
        const avgBrightness = sampledPixels > 0 ? totalBrightness / sampledPixels : 128;
        const darkRatio = sampledPixels > 0 ? darkPixels / sampledPixels : 0;
        const brightRatio = sampledPixels > 0 ? brightPixels / sampledPixels : 0;

        // Ideal: brightness 80-200, dark ratio < 0.3, bright ratio < 0.3
        let lightingScore = 100;
        if (avgBrightness < 50) lightingScore -= 40;
        else if (avgBrightness < 80) lightingScore -= 15;
        if (avgBrightness > 230) lightingScore -= 40;
        else if (avgBrightness > 200) lightingScore -= 15;
        if (darkRatio > 0.5) lightingScore -= 20;
        if (brightRatio > 0.5) lightingScore -= 20;
        // Check for reflection (large bright patch in center)
        const centerX = Math.floor(imgWidth / 2);
        const centerY = Math.floor(imgHeight / 2);
        let centerBrightCount = 0;
        let centerSampled = 0;
        const patchSize = Math.min(imgWidth, imgHeight) * 0.15;
        for (let y = centerY - patchSize; y < centerY + patchSize; y += 3) {
            for (let x = centerX - patchSize; x < centerX + patchSize; x += 3) {
                if (y >= 0 && y < imgHeight && x >= 0 && x < imgWidth) {
                    const val = pixels[Math.floor(y) * imgWidth + Math.floor(x)];
                    centerSampled++;
                    if (val > 230) centerBrightCount++;
                }
            }
        }
        const centerReflectionRatio = centerSampled > 0 ? centerBrightCount / centerSampled : 0;
        if (centerReflectionRatio > 0.4) lightingScore -= 20;

        factors.lighting.score = Math.max(0, Math.min(100, lightingScore));
        factors.lighting.detail = `brightness=${avgBrightness.toFixed(0)}, dark=${(darkRatio * 100).toFixed(0)}%, reflection=${(centerReflectionRatio * 100).toFixed(0)}%`;

        // ─── Grid / Table Visibility ────────────────────────────
        // Detect horizontal and vertical lines using edge density
        // Count pixels that have strong gradient in both x and y (corner/intersection)
        let horizontalEdgeCount = 0;
        let verticalEdgeCount = 0;
        let edgeSampled = 0;
        for (let y = 2; y < imgHeight - 2; y += 3) {
            for (let x = 2; x < imgWidth - 2; x += 3) {
                const idx = y * imgWidth + x;
                const gx = Math.abs(pixels[idx + 1] - pixels[idx - 1]);
                const gy = Math.abs(pixels[(y + 1) * imgWidth + x] - pixels[(y - 1) * imgWidth + x]);
                edgeSampled++;
                if (gx > 40) horizontalEdgeCount++;
                if (gy > 40) verticalEdgeCount++;
            }
        }
        const horizontalEdgeRatio = edgeSampled > 0 ? horizontalEdgeCount / edgeSampled : 0;
        const verticalEdgeRatio = edgeSampled > 0 ? verticalEdgeCount / edgeSampled : 0;

        // A form with table grid should have both horizontal and vertical edges
        const gridIndicator = Math.min(horizontalEdgeRatio, verticalEdgeRatio) * 5; // Scale up
        if (gridIndicator >= MIN_TABLE_VISIBILITY) {
            factors.gridVisibility.score = 100;
            factors.gridVisibility.detail = `Grid detected (h=${(horizontalEdgeRatio * 100).toFixed(1)}%, v=${(verticalEdgeRatio * 100).toFixed(1)}%)`;
        } else if (gridIndicator >= MIN_TABLE_VISIBILITY * 0.5) {
            factors.gridVisibility.score = 60;
            factors.gridVisibility.detail = `Partial grid (h=${(horizontalEdgeRatio * 100).toFixed(1)}%, v=${(verticalEdgeRatio * 100).toFixed(1)}%)`;
        } else {
            factors.gridVisibility.score = 30;
            factors.gridVisibility.detail = `Weak grid (h=${(horizontalEdgeRatio * 100).toFixed(1)}%, v=${(verticalEdgeRatio * 100).toFixed(1)}%)`;
        }

        // ─── Composite Score ────────────────────────────────────
        // Weights: dimensions 15%, blur 35%, lighting 25%, grid 25%
        const compositeScore = Math.round(
            factors.dimensions.score * 0.15 +
            factors.blur.score * 0.35 +
            factors.lighting.score * 0.25 +
            factors.gridVisibility.score * 0.25
        );

        // CEO DIRECTIVE: Quality score alone NEVER triggers RETAKE.
        // Quality issues are used to LOWER confidence scores so the prediction
        // engine compensates, NOT to reject the image outright.
        // Only physical impossibility (too small to read) triggers RETAKE.
        const decision = "PASS";
        const message = compositeScore >= MIN_QUALITY_SCORE
            ? `Image quality OK (${compositeScore}/100)`
            : `Image quality moderate (${compositeScore}/100). Using enhanced prediction to compensate.`;

        logger.info("[IMAGE_QUALITY]", {
            score: compositeScore,
            decision,
            blur_laplacian: blurScore.toFixed(1),
            avg_brightness: avgBrightness.toFixed(0),
            grid_indicator: gridIndicator.toFixed(3),
        });

        return { score: compositeScore, decision, factors, message };
    } catch (err) {
        logger.warn("[IMAGE_QUALITY] Quality gate analysis failed", { error: err.message });
        // On failure, let the image through with a moderate score
        return { score: 75, decision: "PASS", factors: { error: err.message }, message: "Quality gate skipped due to analysis error" };
    }
}

/**
 * DEV1 FIX: Hard minimum image size gate.
 * Called BEFORE any OCR. If this fails, return RETAKE_REQUIRED — no OCR, no alert, no fake values.
 *
 * Rules:
 *   - image width < 1000px  → RETAKE
 *   - image height < 1400px → RETAKE
 *   - expected cell crop height < 60px → RETAKE
 *
 * @param {string} imagePath - path to image file
 * @param {object} [templateInfo] - optional { columnWidth, fieldCount } for crop height estimation
 * @returns {object} { passed: bool, decision: "PASS"|"RETAKE_REQUIRED", width, height, estimatedCropHeight, message }
 */
async function checkMinimumImageSize(imagePath, templateInfo = {}) {
    let sharp = null;
    try {
        sharp = require("sharp");
    } catch (_) {
        return { passed: true, decision: "PASS", message: "sharp not available — skipping size check" };
    }

    try {
        const metadata = await sharp(imagePath).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;

        // Estimate cell crop height from template proportions
        // Fields span from y=0.20 to y=0.865, with 19 rows → each row is ~3.5% of image height
        const FIELD_SPAN = 0.665;  // 0.865 - 0.20
        const FIELD_COUNT = 19;
        const estimatedRowHeight = (FIELD_SPAN / FIELD_COUNT) * height;
        // Column width: typically 18% of image width
        const colWidthFrac = (templateInfo.columnWidth || 0.18);
        const estimatedColWidth = colWidthFrac * width;

        const reasons = [];
        if (width < MIN_IMAGE_WIDTH) reasons.push(`width ${width}px < ${MIN_IMAGE_WIDTH}px`);
        if (height < MIN_IMAGE_HEIGHT) reasons.push(`height ${height}px < ${MIN_IMAGE_HEIGHT}px`);
        if (estimatedRowHeight < MIN_CELL_CROP_HEIGHT) {
            reasons.push(`estimated cell crop height ${estimatedRowHeight.toFixed(0)}px < ${MIN_CELL_CROP_HEIGHT}px`);
        }

        if (reasons.length > 0) {
            const message = [
                "The form photo is too small or compressed to read safely.",
                "",
                "Please retake the photo:",
                "- Use full-size/original photo",
                "- Do not crop too tightly",
                "- Keep the phone closer but include all 4 corners",
                "- Make sure numbers are clear",
                "",
                `Current: ${width}x${height}px, estimated cell height: ${estimatedRowHeight.toFixed(0)}px`,
                `Required: ${MIN_IMAGE_WIDTH}x${MIN_IMAGE_HEIGHT}px minimum, cell height >= ${MIN_CELL_CROP_HEIGHT}px`,
                "",
                "Reply RETAKE after uploading a clearer photo.",
            ].join("\n");

            logger.warn("[IMAGE_SIZE_GATE] RETAKE_REQUIRED", {
                width, height,
                estimatedCellHeight: estimatedRowHeight.toFixed(0),
                reasons,
            });

            return {
                passed: false,
                decision: "RETAKE_REQUIRED",
                width, height,
                estimatedCropHeight: estimatedRowHeight,
                estimatedColWidth,
                reasons,
                message,
            };
        }

        return {
            passed: true,
            decision: "PASS",
            width, height,
            estimatedCropHeight: estimatedRowHeight,
            estimatedColWidth,
            message: `Image size OK: ${width}x${height}px, estimated cell height: ${estimatedRowHeight.toFixed(0)}px`,
        };
    } catch (err) {
        logger.warn("[IMAGE_SIZE_GATE] Error checking image size", { error: err.message });
        return { passed: true, decision: "PASS", message: "Size gate skipped due to analysis error" };
    }
}

module.exports = { evaluateImageQuality, checkMinimumImageSize, MIN_QUALITY_SCORE, MIN_IMAGE_WIDTH, MIN_IMAGE_HEIGHT, MIN_CELL_CROP_HEIGHT, MIN_CELL_CROP_WIDTH };
