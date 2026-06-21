"""
form_preprocessor.py
=====================
OpenCV-based form preprocessing pipeline:
1. Load image
2. Auto-detect form edges
3. Perspective correction
4. Remove noise / deskew
"""

import cv2
import numpy as np
from typing import Optional, Tuple


def load_image(image_path: str) -> Optional[np.ndarray]:
    """Load an image from disk. Returns None on failure."""
    img = cv2.imread(image_path)
    if img is None:
        return None
    return img


def load_image_from_bytes(data: bytes) -> Optional[np.ndarray]:
    """Load an image from bytes (Base64-decoded or raw)."""
    nparr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    return img


def to_grayscale(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def get_image_size(img: np.ndarray) -> Tuple[int, int]:
    """Returns (width, height)"""
    h, w = img.shape[:2]
    return w, h


def resize_to_standard(img: np.ndarray, max_width: int = 1200) -> np.ndarray:
    """Resize image maintaining aspect ratio, capped at max_width."""
    h, w = img.shape[:2]
    if w <= max_width:
        return img
    scale = max_width / w
    new_w = int(w * scale)
    new_h = int(h * scale)
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)


# ─── Perspective Correction ────────────────────────────────────────────────────

def auto_detect_form_edges(img: np.ndarray) -> Optional[np.ndarray]:
    """
    Detect the four corners of a rectangular form in the image using edge detection.
    Returns ordered corners as np.array of shape (4, 2): top-left, top-right,
    bottom-right, bottom-left. Returns None if no rectangle found.
    """
    gray = to_grayscale(img)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)

    # Close the edges to connect contours
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Find the largest quadrilateral contour
    best_cnt = None
    best_area = 0
    for cnt in contours:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) == 4:
            area = cv2.contourArea(approx)
            if area > best_area:
                best_area = area
                best_cnt = approx

    if best_cnt is None or best_area < (img.shape[0] * img.shape[1] * 0.05):
        return None

    return order_corners(best_cnt.reshape(4, 2))


def order_corners(pts: np.ndarray) -> np.ndarray:
    """Order corners: top-left, top-right, bottom-right, bottom-left."""
    pts = pts.astype(np.float64)
    # Sum = top-left + bottom-right (smallest), bottom-left + top-right (largest)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)

    top_left = pts[np.argmin(s)]
    bottom_right = pts[np.argmax(s)]
    top_right = pts[np.argmin(diff)]
    bottom_left = pts[np.argmax(diff)]

    return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float64)


def compute_perspective_transform(src_corners: np.ndarray, dst_size: Tuple[int, int]) -> Tuple[np.ndarray, np.ndarray]:
    """Compute homography matrix for perspective correction.

    Args:
        src_corners: 4x2 ordered corners from the detected form
        dst_size: (width, height) of the output corrected image

    Returns:
        (M, warped) where M is the 3x3 transform matrix and warped is the
        corrected image. Caller uses cv2.warpPerspective(img, M, dst_size).
    """
    w, h = dst_size
    dst_corners = np.array([
        [0, 0],
        [w - 1, 0],
        [w - 1, h - 1],
        [0, h - 1],
    ], dtype=np.float64)

    M = cv2.getPerspectiveTransform(src_corners, dst_corners)
    return M


def perspective_correct(img: np.ndarray) -> Tuple[np.ndarray, dict]:
    """
    Detect and correct the perspective of a form in the image.

    Returns:
        (corrected_img, meta) where meta has:
            - "corrected": bool
            - "corners": detected corners (if found)
            - "angle": skew angle in degrees (if detectable)
    """
    h, w = img.shape[:2]
    meta = {"corrected": False, "corners": None, "angle": 0.0}

    corners = auto_detect_form_edges(img)
    if corners is None:
        # Fallback: deskew by Hough lines
        corrected = deskew_by_hough(img)
        if corrected is not img:
            meta["corrected"] = True
            meta["method"] = "hough_deskew"
        return corrected, meta

    # Compute output size: use the max of the two side pairs
    (tl, tr, br, bl) = corners
    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = max(int(width_a), int(width_b))

    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = max(int(height_a), int(height_b))

    dst_size = (max_width, max_height)

    M = compute_perspective_transform(corners, dst_size)
    corrected = cv2.warpPerspective(img, M, dst_size,
                                     flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_CONSTANT,
                                     borderValue=(255, 255, 255))

    meta["corrected"] = True
    meta["corners"] = corners.tolist()
    meta["method"] = "homography"
    return corrected, meta


def deskew_by_hough(img: np.ndarray) -> np.ndarray:
    """Simple deskew using Hough line detection as fallback."""
    gray = to_grayscale(img)
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLines(edges, 1, np.pi / 180, threshold=100)
    if lines is None or len(lines) == 0:
        return img

    angles = []
    for line in lines[:50]:
        rho, theta = line[0]
        if 0.1 < theta < np.pi / 2:
            angle = (theta * 180 / np.pi) - 90
            angles.append(angle)

    if not angles:
        return img

    median_angle = np.median(angles)
    if abs(median_angle) < 0.5:
        return img

    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), median_angle, 1.0)
    rotated = cv2.warpAffine(img, M, (w, h),
                               flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_CONSTANT,
                               borderValue=(255, 255, 255))
    return rotated


# ─── Image Enhancement ────────────────────────────────────────────────────────

def enhance_for_ocr(img: np.ndarray) -> np.ndarray:
    """
    Enhance a grayscale image for better OCR results.
    Steps: adaptive threshold, denoise, contrast boost.
    """
    gray = to_grayscale(img)

    # Denoise
    denoised = cv2.fastNlMeansDenoising(gray, None, h=10, templateWindowSize=7)

    # CLAHE for contrast
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)

    # Adaptive threshold to binarize (good for handwritten digits)
    binary = cv2.adaptiveThreshold(
        enhanced, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=11,
        C=2
    )

    return binary


def remove_table_lines(binary_img: np.ndarray, horizontal: bool = True, vertical: bool = True) -> np.ndarray:
    """
    Remove strong horizontal and vertical lines from a binary image.
    Useful for cleaning table borders from form images.
    """
    result = binary_img.copy()
    h, w = result.shape

    if horizontal:
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (w // 20, 1))
        detected_h_lines = cv2.morphologyEx(result, cv2.MORPH_OPEN, horizontal_kernel, iterations=2)
        result = cv2.subtract(result, detected_h_lines)

    if vertical:
        vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, h // 20))
        detected_v_lines = cv2.morphologyEx(result, cv2.MORPH_OPEN, vertical_kernel, iterations=2)
        result = cv2.subtract(result, detected_v_lines)

    return result


def crop_to_region(img: np.ndarray, x1: int, y1: int, x2: int, y2: int) -> np.ndarray:
    """Crop a rectangular region from an image. Bounds-checked."""
    h, w = img.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return img
    return img[y1:y2, x1:x2]


def enlarge_cell(cell_img: np.ndarray, scale: int = 3) -> np.ndarray:
    """Enlarge a cell image by integer scale factor (for better OCR accuracy)."""
    h, w = cell_img.shape[:2]
    return cv2.resize(cell_img, (w * scale, h * scale),
                       interpolation=cv2.INTER_CUBIC)


def preprocess_cell(img: np.ndarray, remove_lines: bool = True, scale: int = 3) -> np.ndarray:
    """
    Full preprocessing pipeline for a single cell image:
    1. Grayscale
    2. Denoise
    3. Contrast enhancement
    4. Binarize
    5. Remove table lines
    6. Enlarge for OCR
    """
    cell = img.copy()

    if len(cell.shape) == 3:
        cell = to_grayscale(cell)

    # Denoise
    cell = cv2.fastNlMeansDenoising(cell, None, h=10, templateWindowSize=7)

    # Contrast
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    cell = clahe.apply(cell)

    # Binarize
    cell = cv2.adaptiveThreshold(
        cell, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=7,
        C=5
    )

    # Remove lines
    if remove_lines:
        cell = remove_table_lines(cell, horizontal=True, vertical=True)

    # Invert so text is white on black (PaddleOCR prefers this)
    cell = cv2.bitwise_not(cell)

    # Enlarge
    cell = enlarge_cell(cell, scale=scale)

    return cell


# ─── Full Preprocessing Pipeline ─────────────────────────────────────────────

def preprocess_form(image_path: str = None,
                    image_data: bytes = None,
                    apply_perspective: bool = True,
                    enhance: bool = True) -> Tuple[np.ndarray, dict]:
    """
    Run the full form preprocessing pipeline.

    Args:
        image_path: path to image file
        image_data: raw bytes of image (alternative to path)
        apply_perspective: whether to do perspective correction
        enhance: whether to apply OCR enhancement

    Returns:
        (processed_img, meta) where meta contains debug info
    """
    meta = {"steps": []}

    if image_path:
        img = load_image(image_path)
    elif image_data:
        img = load_image_from_bytes(image_data)
    else:
        raise ValueError("Must provide image_path or image_data")

    if img is None:
        raise ValueError("Could not load image")

    h, w = img.shape[:2]
    meta["steps"].append(f"loaded: {w}x{h}")

    if apply_perspective:
        img, correction_meta = perspective_correct(img)
        if correction_meta.get("corrected"):
            meta["steps"].append(f"perspective_corrected: {correction_meta.get('method', 'unknown')}")
            meta["perspective"] = correction_meta

    if enhance:
        gray = to_grayscale(img)
        img = enhance_for_ocr(img)
        meta["steps"].append("enhanced_for_ocr")

    meta["final_size"] = {"width": img.shape[1], "height": img.shape[0]}
    return img, meta
