from __future__ import annotations

import base64
import time
from typing import Any

import cv2
import numpy as np


def decode_base64_image(image_data: str) -> np.ndarray:
    payload = image_data.split(",", 1)[-1]
    image_bytes = base64.b64decode(payload)
    image_array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image data.")
    return image


def encode_image_to_base64(image: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".jpg", image)
    if not ok:
        raise ValueError("Could not encode processed image.")
    return base64.b64encode(buffer.tobytes()).decode("utf-8")


def order_points(points: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1)
    rect[0] = points[np.argmin(sums)]
    rect[2] = points[np.argmax(sums)]
    rect[1] = points[np.argmin(diffs)]
    rect[3] = points[np.argmax(diffs)]
    return rect


def four_point_transform(image: np.ndarray, points: np.ndarray) -> np.ndarray:
    rect = order_points(points)
    top_left, top_right, bottom_right, bottom_left = rect

    width_a = np.linalg.norm(bottom_right - bottom_left)
    width_b = np.linalg.norm(top_right - top_left)
    max_width = max(int(width_a), int(width_b), 1)

    height_a = np.linalg.norm(top_right - bottom_right)
    height_b = np.linalg.norm(top_left - bottom_left)
    max_height = max(int(height_a), int(height_b), 1)

    destination = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, destination)
    return cv2.warpPerspective(image, matrix, (max_width, max_height))


def enhance_grayscale(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def enhance_black_white(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, thresholded = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.cvtColor(thresholded, cv2.COLOR_GRAY2BGR)


def enhance_color(image: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_channel = clahe.apply(l_channel)
    merged = cv2.merge((l_channel, a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def enhance_receipt(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, 7, 60, 60)
    thresholded = cv2.adaptiveThreshold(
        filtered,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        25,
        15,
    )
    return cv2.cvtColor(thresholded, cv2.COLOR_GRAY2BGR)


def denoise_image(image: np.ndarray, strength: float) -> np.ndarray:
    if strength <= 0:
        return image
    h_value = max(3, int(3 + strength * 0.18))
    return cv2.fastNlMeansDenoisingColored(image, None, h_value, h_value, 7, 21)


def sharpen_image(image: np.ndarray, amount: float) -> np.ndarray:
    if amount <= 0:
        return image
    blur = cv2.GaussianBlur(image, (0, 0), 3)
    alpha = 1.0 + amount * 0.02
    beta = -amount * 0.02
    return cv2.addWeighted(image, alpha, blur, beta, 0)


def upscale_image(image: np.ndarray, enabled: bool) -> np.ndarray:
    if not enabled:
        return image
    return cv2.resize(image, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)


def apply_brightness_contrast(image: np.ndarray, brightness: float, contrast: float) -> np.ndarray:
    alpha = 1.0 + (contrast / 100.0)
    beta = brightness * 1.5
    return cv2.convertScaleAbs(image, alpha=alpha, beta=beta)


def rotate_image(image: np.ndarray, rotate_value: int) -> np.ndarray:
    normalized = rotate_value % 360
    if normalized == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if normalized == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    if normalized == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return image


def parse_corner_points(corner_points: dict[str, Any] | None, image: np.ndarray) -> np.ndarray:
    if not corner_points:
        height, width = image.shape[:2]
        return np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32")

    ordered = [
        corner_points["topLeft"],
        corner_points["topRight"],
        corner_points["bottomRight"],
        corner_points["bottomLeft"],
    ]
    return np.array([[float(point["x"]), float(point["y"])] for point in ordered], dtype="float32")


def select_enhancement_mode(image: np.ndarray, enhancement_mode: str) -> np.ndarray:
    if enhancement_mode == "grayscale":
        return enhance_grayscale(image)
    if enhancement_mode == "black_white":
        return enhance_black_white(image)
    if enhancement_mode == "color_enhanced":
        return enhance_color(image)
    if enhancement_mode == "high_contrast":
        return enhance_black_white(apply_brightness_contrast(image, 8, 28))
    if enhancement_mode == "receipt":
        return enhance_receipt(image)
    if enhancement_mode == "contract":
        return enhance_black_white(apply_brightness_contrast(image, 4, 18))
    if enhancement_mode == "id_passport":
        return enhance_color(apply_brightness_contrast(image, 2, 12))
    return image


def main(
    imageData: str,
    cornerPoints: dict[str, Any] | None = None,
    enhancementMode: str = "original",
    rotateValue: int = 0,
    upscale: bool = False,
    cleanupSettings: dict[str, Any] | None = None,
    userId: str | None = None,
    scanSessionId: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    cleanup = cleanupSettings or {}
    try:
        image = decode_base64_image(imageData)
        points = parse_corner_points(cornerPoints, image)

        try:
            processed = four_point_transform(image, points)
        except Exception:
            processed = image.copy()

        processed = rotate_image(processed, rotateValue)
        processed = upscale_image(processed, bool(upscale))

        try:
            processed = apply_brightness_contrast(
                processed,
                float(cleanup.get("brightness", 0)),
                float(cleanup.get("contrast", 0)),
            )
            processed = select_enhancement_mode(processed, enhancementMode)
            processed = denoise_image(processed, float(cleanup.get("denoise", 0)))
            processed = sharpen_image(processed, float(cleanup.get("sharpness", 0)))
        except Exception:
            processed = processed

        height, width = processed.shape[:2]
        encoded = encode_image_to_base64(processed)
        return {
            "success": True,
            "result": {
                "processedImage": encoded,
                "metadata": {
                    "width": width,
                    "height": height,
                    "enhancementMode": enhancementMode,
                    "rotateValue": rotateValue,
                    "upscale": upscale,
                    "userId": userId,
                    "scanSessionId": scanSessionId,
                    "metadata": metadata or {},
                },
                "processingStatus": "processed",
            },
            "processingTimeMs": round((time.perf_counter() - started_at) * 1000, 2),
            "scanQualityMetadata": {
                "cleanupApplied": bool(cleanup.get("autoClean", False)),
                "enhancementMode": enhancementMode,
            },
        }
    except Exception as error:
        return {
            "success": False,
            "error": str(error),
            "processingTimeMs": round((time.perf_counter() - started_at) * 1000, 2),
        }
