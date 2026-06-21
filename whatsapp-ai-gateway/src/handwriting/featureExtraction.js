/**
 * featureExtraction.js — Phase 3: Handwriting Feature Extraction
 * 
 * Generates fingerprints for cropped cell images.
 * Layer A: Simple Image Fingerprint (OpenCV-like via sharp/canvas or pure JS)
 * Layer B: Embedding (optional, falls back to Layer A)
 * 
 * Uses sharp for image processing (available on most systems without native deps).
 * Falls back to pure-JS hash if sharp is unavailable.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require("../logger");

const NORMALIZED_SIZE = 64; // Fixed size for fingerprint
const SAMPLES_BASE = path.join(__dirname, "..", "..", "data", "handwriting", "samples");

// Try to load sharp for image processing
let sharp = null;
try {
    sharp = require("sharp");
} catch (_) {
    logger.warn("sharp not available — using fallback fingerprinting");
}

// ─── Image Preprocessing ───────────────────────────────────────────────

/**
 * Normalize an image to a standard size, grayscale, binary threshold.
 * Returns { fingerprint, outputPath, width, height }
 */
async function normalizeImage(inputPath) {
    const outputDir = path.join(SAMPLES_BASE, "_normalized");
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const basename = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${basename}_norm.png`);

    if (sharp) {
        return await normalizeWithSharp(inputPath, outputPath);
    } else {
        return await normalizeFallback(inputPath, outputPath);
    }
}

/**
 * Normalize using sharp (preferred)
 */
async function normalizeWithSharp(inputPath, outputPath) {
    const image = sharp(inputPath);

    // Get metadata
    const metadata = await image.metadata();
    const origWidth = metadata.width || 100;
    const origHeight = metadata.height || 100;

    // Process: resize, grayscale, threshold
    await image
        .resize(NORMALIZED_SIZE, NORMALIZED_SIZE, {
            fit: "fill",
            kernel: sharp.kernel.nearest,
        })
        .grayscale()
        .threshold(128) // Binary threshold
        .png()
        .toFile(outputPath);

    // Read the processed image as raw pixels for fingerprint
    const rawPixels = await sharp(outputPath)
        .raw()
        .toBuffer();

    const fingerprint = computeFingerprint(rawPixels);
    const binaryVector = rawToBinaryVector(rawPixels);

    return {
        fingerprint,
        binaryVector,
        outputPath,
        width: NORMALIZED_SIZE,
        height: NORMALIZED_SIZE,
        origWidth,
        origHeight,
    };
}

/**
 * Fallback normalization without sharp
 */
async function normalizeFallback(inputPath, outputPath) {
    // Create a basic fingerprint from file hash + size
    const fileBuffer = fs.readFileSync(inputPath);
    const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    // Simple perceptual-like hash from file content sampling
    const sampleSize = Math.min(fileBuffer.length, 4096);
    const samples = [];
    for (let i = 0; i < sampleSize; i += 16) {
        samples.push(fileBuffer[i]);
    }
    const sampleHash = crypto.createHash("md5").update(Buffer.from(samples)).digest("hex");

    // Copy original as-is since we can't process
    fs.copyFileSync(inputPath, outputPath);

    return {
        fingerprint: `${hash.substring(0, 32)}:${sampleHash}`,
        binaryVector: null,
        outputPath,
        width: 0,
        height: 0,
        origWidth: 0,
        origHeight: 0,
    };
}

// ─── Fingerprint Computation ───────────────────────────────────────────

/**
 * Compute a compact fingerprint from raw grayscale pixel buffer
 */
function computeFingerprint(rawBuffer) {
    if (!rawBuffer || rawBuffer.length === 0) {
        return crypto.randomBytes(16).toString("hex");
    }

    // Simple perceptual hash: divide image into 8x8 grid, compare avg brightness
    const size = NORMALIZED_SIZE;
    const blockSize = Math.floor(size / 8);
    const bits = [];

    for (let gy = 0; gy < 8; gy++) {
        for (let gx = 0; gx < 8; gx++) {
            let sum = 0;
            let count = 0;
            for (let y = gy * blockSize; y < (gy + 1) * blockSize && y < size; y++) {
                for (let x = gx * blockSize; x < (gx + 1) * blockSize && x < size; x++) {
                    const idx = y * size + x;
                    if (idx < rawBuffer.length) {
                        sum += rawBuffer[idx];
                        count++;
                    }
                }
            }
            bits.push(count > 0 ? sum / count : 0);
        }
    }

    // Global average threshold
    const avg = bits.reduce((a, b) => a + b, 0) / bits.length;
    const hashBits = bits.map((v) => (v >= avg ? 1 : 0));

    // Convert to hex string
    let hex = "";
    for (let i = 0; i < hashBits.length; i += 4) {
        const nibble = (hashBits[i] << 3) | (hashBits[i + 1] << 2) | (hashBits[i + 2] << 1) | (hashBits[i + 3] || 0);
        hex += nibble.toString(16);
    }

    return hex;
}

/**
 * Convert raw pixels to a binary vector (0/1 per pixel, downsampled)
 */
function rawToBinaryVector(rawBuffer) {
    if (!rawBuffer || rawBuffer.length === 0) return null;

    // Sample every 4th pixel for compact vector
    const vector = [];
    const step = 4;
    for (let i = 0; i < rawBuffer.length; i += step) {
        vector.push(rawBuffer[i] > 128 ? 1 : 0);
    }
    return vector;
}

// ─── Fingerprint Similarity ────────────────────────────────────────────

/**
 * Compute Hamming distance between two hex fingerprints
 */
function hammingDistance(fp1, fp2) {
    if (!fp1 || !fp2) return 1;
    const a = Buffer.from(fp1, "hex");
    const b = Buffer.from(fp2, "hex");
    const len = Math.min(a.length, b.length);
    let distance = 0;
    for (let i = 0; i < len; i++) {
        let xor = a[i] ^ b[i];
        while (xor) {
            distance += xor & 1;
            xor >>= 1;
        }
    }
    return distance;
}

/**
 * Compute similarity score (0-1) between two fingerprints
 * 1 = identical, 0 = completely different
 */
function fingerprintSimilarity(fp1, fp2) {
    if (!fp1 || !fp2) return 0;
    const maxBits = fp1.length * 4; // 4 bits per hex char
    const dist = hammingDistance(fp1, fp2);
    return 1 - dist / maxBits;
}

/**
 * Compute cosine similarity between two binary vectors
 */
function cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2) return 0;
    const len = Math.min(vec1.length, vec2.length);
    if (len === 0) return 0;

    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;

    for (let i = 0; i < len; i++) {
        dotProduct += vec1[i] * vec2[i];
        mag1 += vec1[i] * vec1[i];
        mag2 += vec2[i] * vec2[i];
    }

    const denominator = Math.sqrt(mag1) * Math.sqrt(mag2);
    return denominator > 0 ? dotProduct / denominator : 0;
}

/**
 * Combined similarity score using fingerprint + optional vector
 */
function combinedSimilarity(sample1, sample2) {
    let score = 0;
    let components = 0;

    // Fingerprint similarity (60% weight)
    if (sample1.fingerprint && sample2.fingerprint) {
        score += fingerprintSimilarity(sample1.fingerprint, sample2.fingerprint) * 0.6;
        components++;
    }

    // Binary vector similarity (40% weight)
    if (sample1.binaryVector && sample2.binaryVector) {
        score += cosineSimilarity(sample1.binaryVector, sample2.binaryVector) * 0.4;
        components++;
    }

    // If only one component available, use it at full weight
    if (components === 0) return 0;
    if (components === 1) return score / 0.6; // Normalize to full weight

    return score;
}

/**
 * Extract features from an image and return as a feature object
 */
async function extractFeatures(imagePath) {
    try {
        const result = await normalizeImage(imagePath);
        return {
            fingerprint: result.fingerprint,
            binaryVector: result.binaryVector,
            width: result.width,
            height: result.height,
        };
    } catch (err) {
        logger.warn("Feature extraction failed", { imagePath, error: err.message });
        // Return a hash-based fallback
        const fileBuffer = fs.readFileSync(imagePath);
        return {
            fingerprint: crypto.createHash("sha256").update(fileBuffer).digest("hex").substring(0, 32),
            binaryVector: null,
            width: 0,
            height: 0,
        };
    }
}

module.exports = {
    normalizeImage,
    extractFeatures,
    computeFingerprint,
    fingerprintSimilarity,
    cosineSimilarity,
    combinedSimilarity,
    hammingDistance,
    NORMALIZED_SIZE,
};
