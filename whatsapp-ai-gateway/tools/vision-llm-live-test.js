/**
 * vision-llm-live-test.js
 * =======================
 * Simulates a WhatsApp image message going through the full pipeline.
 * This bypasses WhatsApp and calls the foodSafetyHandler directly with
 * the image bytes, mimicking what would happen when a real form image
 * is received in the LD Agent-Logtest group.
 *
 * Usage: node tools/vision-llm-live-test.js
 */

const path = require("path");
const fs = require("fs");
const { handleImageMessage } = require("../src/foodSafetyHandler");

// Use the Stone Oak test image (already has aligned form)
const testImagePath = path.join(__dirname, "..", "..", "handwriting-pivot", "eval", "form_stone_oak.png");

async function main() {
    console.log("=== Vision LLM Live Test ===\n");
    console.log(`Image: ${testImagePath}`);

    if (!fs.existsSync(testImagePath)) {
        console.error("Image not found:", testImagePath);
        process.exit(1);
    }

    const imageBuffer = fs.readFileSync(testImagePath);
    console.log(`Image size: ${(imageBuffer.length / 1024).toFixed(1)} KB\n`);

    // Mock WhatsApp message object
    const mockMessage = {
        id: { _serialized: `test-${Date.now()}` },
        from: "1234567890@c.us",
        fromMe: false,
        body: "",
        hasMedia: true,
        downloadMedia: async () => ({
            data: imageBuffer.toString("base64"),
            mimeType: "image/jpeg",
        }),
        _chatName: "B2 Kitchen Log",
        _data: { chatName: "B2 Kitchen Log" },
        _imageHash: "live-test-hash",
        _cachedMedia: { data: imageBuffer.toString("base64") },
    };

    // Mock client (the functions the handler needs)
    const mockClient = {
        sendMessage: async (chatId, text, options) => {
            console.log("\n=== WhatsApp Reply ===");
            console.log(text);
            console.log("======================\n");
        },
    };

    console.log("Sending image through foodSafetyHandler...");
    console.log("(This goes through fullFormOCR -> Vision LLM pipeline)\n");

    try {
        const reply = await handleImageMessage(mockMessage, mockClient);
        if (reply) {
            console.log("Reply returned:", reply.substring(0, 200), "...");
        } else {
            console.log("Reply: null (handler may reply via sendMessage)");
        }
    } catch (err) {
        console.error("Error:", err.message);
        if (err.stack) console.error(err.stack.split("\n").slice(0, 5).join("\n"));
    }
}

main().catch(console.error);
