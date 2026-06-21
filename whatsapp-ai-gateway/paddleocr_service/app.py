"""
app.py
======
Flask REST API for PaddleOCR Cell Extraction Service.
"""

import os
import sys
import json
import base64
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS

# Apply PaddleOCR / PaddlePaddle Windows compatibility patch before any paddle imports.
try:
    import paddleocr_patch  # noqa: F401
except Exception:
    pass

from form_preprocessor import preprocess_form, load_image_from_bytes
from cell_extractor import extract_full_form
from template_cell_maps import get_all_templates, get_template

app = Flask(__name__)
CORS(app)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("paddleocr_service")

PORT = int(os.environ.get("PADDLEOCR_PORT", 5501))


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "paddleocr", "status": "ok", "port": PORT})


@app.route("/templates", methods=["GET"])
def list_templates():
    templates = get_all_templates()
    return jsonify({
        "templates": [
            {
                "template_id": tid,
                "store_name": t.get("store_name"),
                "store_code": t.get("store_code"),
                "field_count": len(t.get("fields", {})),
            }
            for tid, t in templates.items()
        ]
    })


@app.route("/extract", methods=["POST"])
def extract():
    """
    Extract temperatures from a form image.

    Request body (JSON or multipart):
        image: base64-encoded image string OR file upload
        template_id: template name (e.g. "FoodSafety-StoneOak-v3")
        selected_column: optional ("10am" or "4pm")
        apply_perspective: bool (default True)
        use_gpu: bool (default False)
    """
    try:
        data = request.get_json(silent=True) or {}

        # ── Load image ──────────────────────────────────────────────
        image = None
        raw_image_bytes = None  # Keep original encoded bytes for preprocessing
        if "image" in data:
            img_b64 = data["image"]
            if isinstance(img_b64, str):
                raw_image_bytes = base64.b64decode(img_b64)
            else:
                raw_image_bytes = img_b64
            image = load_image_from_bytes(raw_image_bytes)
        elif request.files and "image" in request.files:
            raw_image_bytes = request.files["image"].read()
            image = load_image_from_bytes(raw_image_bytes)
        else:
            return jsonify({"error": "No image provided"}), 400

        if image is None:
            return jsonify({"error": "Could not decode image"}), 400

        # ── DEV1 FIX: Minimum Image Size Validation ─────────────
        # Reject images too small for reliable cell OCR
        img_h, img_w = image.shape[:2]
        MIN_WIDTH = 1000
        MIN_HEIGHT = 1400
        if img_w < MIN_WIDTH or img_h < MIN_HEIGHT:
            # Estimate cell crop height
            FIELD_SPAN = 0.665  # 0.865 - 0.20
            FIELD_COUNT = 19
            est_cell_height = (FIELD_SPAN / FIELD_COUNT) * img_h
            return jsonify({
                "success": False,
                "error": "IMAGE_TOO_SMALL",
                "message": "The form photo is too small or compressed to read safely.",
                "image_width": img_w,
                "image_height": img_h,
                "estimated_cell_height": round(est_cell_height),
                "min_required_width": MIN_WIDTH,
                "min_required_height": MIN_HEIGHT,
                "min_cell_height": 60,
            }), 200

        # ── Parameters ──────────────────────────────────────────
        template_id = data.get("template_id", "FoodSafety-StoneOak-v3")
        template = get_template(template_id)
        if not template:
            return jsonify({"error": f"Unknown template: {template_id}"}), 400

        selected_column = data.get("selected_column")
        apply_perspective = data.get("apply_perspective", True)
        use_gpu = data.get("use_gpu", False)

        # ── Preprocess ──────────────────────────────────────────────
        # Pass original encoded bytes (JPEG/PNG) so OpenCV can decode properly
        processed, meta = preprocess_form(
            image_data=raw_image_bytes,
            image_path=None,
            apply_perspective=apply_perspective,
            enhance=True,
        )

        # ── Extract ─────────────────────────────────────────────────
        result = extract_full_form(
            form_img=processed,
            template_id=template_id,
            selected_column=selected_column,
            use_gpu=use_gpu,
            debug=False,
        )

        # Compute accuracy metrics
        items = result.get("items", [])
        filled = sum(1 for i in items if i.get("value") is not None)
        warnings = sum(1 for i in items if i.get("status") == "WARNING")
        safe = sum(1 for i in items if i.get("status") == "SAFE")
        unclear = sum(1 for i in items if i.get("status") == "UNCLEAR")

        accuracy = filled / len(items) if items else 0.0

        return jsonify({
            "success": True,
            "result": result,
            "meta": {
                "preprocessing": meta,
                "accuracy": round(accuracy, 4),
                "filled": filled,
                "warnings": warnings,
                "safe": safe,
                "unclear": unclear,
                "total_fields": len(items),
            }
        })

    except Exception as e:
        logger.exception("Extract failed")
        return jsonify({"error": str(e)}), 500


@app.route("/extract_batch", methods=["POST"])
def extract_batch():
    """
    Batch extract from multiple images.

    Request body:
        images: list of base64-encoded images
        template_id: template to use for all
        selected_column: optional
    """
    try:
        data = request.get_json(silent=True) or {}
        images_b64 = data.get("images", [])
        template_id = data.get("template_id", "FoodSafety-StoneOak-v3")
        selected_column = data.get("selected_column")
        use_gpu = data.get("use_gpu", False)

        results = []
        for idx, img_b64 in enumerate(images_b64):
            try:
                img_bytes = base64.b64decode(img_b64)
                image = load_image_from_bytes(img_bytes)
                if image is None:
                    results.append({"index": idx, "error": "Could not decode image"})
                    continue

                processed, meta = preprocess_form(image_path=None, image_data=image)
                result = extract_full_form(
                    form_img=processed,
                    template_id=template_id,
                    selected_column=selected_column,
                    use_gpu=use_gpu,
                )
                results.append({"index": idx, "result": result})
            except Exception as e:
                results.append({"index": idx, "error": str(e)})

        return jsonify({"success": True, "results": results})
    except Exception as e:
        logger.exception("Batch extract failed")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    logger.info(f"Starting PaddleOCR service on port {PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
