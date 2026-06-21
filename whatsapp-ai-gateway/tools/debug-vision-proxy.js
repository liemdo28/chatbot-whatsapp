// debug-vision-proxy.js — Test Vision API proxy connection
const https = require("https");
const fs = require("fs");

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || "https://opusmax.shop/v1";
const MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";

function parseUrl(url) {
    const u = new URL(url);
    return { hostname: u.hostname, port: u.port || "443", path: u.pathname.replace(/\/+$/, "") };
}

async function testApi() {
    const baseUrl = parseUrl(BASE_URL);
    const pathSuffix = baseUrl.path.endsWith("/v1") ? baseUrl.path : (baseUrl.path || "") + "/v1";
    const apiPath = pathSuffix + "/chat/completions";
    const body = JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{
            role: "user",
            content: "You are reviewing a food safety form. The OCR read 300F for a fryer field (SO-16) with expected range 350-360F. What temperature do you think it actually is? Respond with valid JSON only: {\"vision_value\": <number>, \"vision_confidence\": <0.0-1.0>, \"reason\": \"<text>\", \"should_override_ocr\": <true/false>}"
        }]
    });

    console.log("Connecting to:", BASE_URL);
    console.log("Hostname:", baseUrl.hostname);
    console.log("Model:", MODEL);
    console.log("API key prefix:", API_KEY ? API_KEY.substring(0, 7) : "NOT SET");
    console.log("");

    return new Promise((resolve) => {
        const req = https.request({
            hostname: baseUrl.hostname,
            port: baseUrl.port,
            path: apiPath,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + API_KEY,
            },
            timeout: 30000,
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                console.log("Status:", res.statusCode);
                console.log("Content-Type:", res.headers["content-type"]);
                console.log("Raw response (first 1000 chars):");
                console.log(data.substring(0, 1000));
                console.log("");

                try {
                    const parsed = JSON.parse(data);
                    if (parsed.choices && parsed.choices[0]) {
                        const content = parsed.choices[0].message ? parsed.choices[0].message.content : "";
                        console.log("Model response content:");
                        console.log(content);
                        const jsonMatch = content.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const result = JSON.parse(jsonMatch[0]);
                            console.log("\nParsed result:", JSON.stringify(result, null, 2));
                            console.log("\n✅ VISION API PROXY WORKS");
                        } else {
                            console.log("\n⚠️ No JSON found in response");
                        }
                    } else if (parsed.error) {
                        console.log("\n❌ API error:", JSON.stringify(parsed.error, null, 2));
                    } else {
                        console.log("\n⚠️ Unexpected response format");
                    }
                } catch (e) {
                    console.log("\n❌ Parse error:", e.message);
                    console.log("Raw (first 500):", data.substring(0, 500));
                }
                resolve();
            });
        });

        req.on("error", (e) => {
            console.error("Request error:", e.message);
            resolve();
        });

        req.on("timeout", () => {
            console.error("Request timeout");
            req.destroy();
            resolve();
        });

        req.write(body);
        req.end();
    });
}

testApi();
