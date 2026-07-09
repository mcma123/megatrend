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
        raise ValueError("Could not encode preview image.")
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


def fallback_corners(image: np.ndarray) -> dict[str, dict[str, float]]:
    height, width = image.shape[:2]
    return {
        "topLeft": {"x": 0.0, "y": 0.0},
        "topRight": {"x": float(width - 1), "y": 0.0},
        "bottomRight": {"x": float(width - 1), "y": float(height - 1)},
        "bottomLeft": {"x": 0.0, "y": float(height - 1)},
    }


def detect_document_contour(image: np.ndarray) -> tuple[np.ndarray | None, float]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 50, 150)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edged = cv2.dilate(edged, kernel, iterations=1)
    edged = cv2.morphologyEx(edged, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(edged, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    image_area = float(image.shape[0] * image.shape[1])
    best_contour = None
    best_score = 0.0

    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        area = cv2.contourArea(polygon)
        if len(polygon) != 4 or area <= 0:
            continue
        score = area / image_area
        if score > best_score:
            best_contour = polygon.reshape(4, 2)
            best_score = score

    return best_contour, max(0.0, min(best_score, 1.0))


def to_corner_dict(points: np.ndarray) -> dict[str, dict[str, float]]:
    ordered = order_points(points)
    return {
        "topLeft": {"x": float(ordered[0][0]), "y": float(ordered[0][1])},
        "topRight": {"x": float(ordered[1][0]), "y": float(ordered[1][1])},
        "bottomRight": {"x": float(ordered[2][0]), "y": float(ordered[2][1])},
        "bottomLeft": {"x": float(ordered[3][0]), "y": float(ordered[3][1])},
    }


def draw_outline(image: np.ndarray, corners: dict[str, dict[str, float]]) -> np.ndarray:
    preview = image.copy()
    points = np.array(
        [
            [corners["topLeft"]["x"], corners["topLeft"]["y"]],
            [corners["topRight"]["x"], corners["topRight"]["y"]],
            [corners["bottomRight"]["x"], corners["bottomRight"]["y"]],
            [corners["bottomLeft"]["x"], corners["bottomLeft"]["y"]],
        ],
        dtype=np.int32,
    )
    cv2.polylines(preview, [points], True, (0, 255, 255), 6)
    for point in points:
        cv2.circle(preview, tuple(point), 10, (255, 120, 0), -1)
    return preview


def main(
    imageData: str,
    fileName: str | None = None,
    userId: str | None = None,
    scanSessionId: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    try:
        image = decode_base64_image(imageData)
        contour, confidence = detect_document_contour(image)

        warning = None
        if contour is None:
            corners = fallback_corners(image)
            confidence = 0.0
            warning = "No document contour was found. Falling back to the full image."
        else:
            corners = to_corner_dict(contour)

        preview_image = draw_outline(image, corners)
        return {
            "success": True,
            "result": {
                "detectedCorners": corners,
                "confidenceScore": confidence,
                "previewImage": f"data:image/jpeg;base64,{encode_image_to_base64(preview_image)}",
                "warning": warning,
                "fileName": fileName,
                "userId": userId,
                "scanSessionId": scanSessionId,
                "metadata": metadata or {},
            },
            "processingTimeMs": round((time.perf_counter() - started_at) * 1000, 2),
            "scanQualityMetadata": {
                "edgeConfidence": confidence,
                "usedFallback": contour is None,
            },
        }
    except Exception as error:
        return {
            "success": False,
            "error": str(error),
            "processingTimeMs": round((time.perf_counter() - started_at) * 1000, 2),
        }
