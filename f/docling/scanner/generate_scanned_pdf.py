from __future__ import annotations

import base64
import io
import time
from typing import Any

from PIL import Image


def decode_base64_image(image_data: str) -> Image.Image:
    payload = image_data.split(",", 1)[-1]
    image_bytes = base64.b64decode(payload)
    image = Image.open(io.BytesIO(image_bytes))
    return image.convert("RGB")


def pdf_page_size(page_size: str, orientation: str) -> tuple[float | None, float | None]:
    sizes = {
        "a4": (8.27, 11.69),
        "letter": (8.5, 11.0),
        "original": (None, None),
    }
    width, height = sizes.get(page_size, (8.27, 11.69))
    if width is None or height is None:
        return None, None
    if orientation == "landscape":
        return height, width
    return width, height


def create_pdf_from_images(
    images: list[Image.Image],
    page_size: str,
    orientation: str,
    compression: str,
) -> bytes:
    if not images:
        raise ValueError("At least one processed page image is required.")

    resized_images: list[Image.Image] = []
    target_size = pdf_page_size(page_size, orientation)
    jpeg_quality = {"low": 92, "medium": 82, "high": 68}.get(compression, 82)

    for image in images:
        current = image
        if target_size != (None, None):
            width_inches, height_inches = target_size
            assert width_inches is not None and height_inches is not None
            target_pixels = (int(width_inches * 200), int(height_inches * 200))
            current = image.copy()
            current.thumbnail(target_pixels, Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", target_pixels, "white")
            offset = ((target_pixels[0] - current.width) // 2, (target_pixels[1] - current.height) // 2)
            canvas.paste(current, offset)
            current = canvas
        resized_images.append(current)

    output = io.BytesIO()
    first, rest = resized_images[0], resized_images[1:]
    first.save(
        output,
        format="PDF",
        resolution=200.0,
        save_all=True,
        append_images=rest,
        quality=jpeg_quality,
        optimize=True,
    )
    return output.getvalue()


def main(
    pageImages: list[dict[str, Any]],
    pdfFileName: str,
    pageSize: str = "a4",
    orientation: str = "auto",
    compression: str = "medium",
    userId: str | None = None,
    scanSessionId: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    failed_pages: list[dict[str, str]] = []
    images: list[Image.Image] = []

    try:
        for page in pageImages:
            try:
                image_data = str(page.get("imageBase64") or "")
                images.append(decode_base64_image(image_data))
            except Exception as error:
                failed_pages.append(
                    {
                        "id": str(page.get("id") or ""),
                        "name": str(page.get("name") or "page"),
                        "error": str(error),
                    }
                )

        pdf_bytes = create_pdf_from_images(images, pageSize, orientation, compression)
        pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")
        return {
            "success": True,
            "result": {
                "pdfBase64": pdf_base64,
                "metadata": {
                    "pageCount": len(images),
                    "fileSize": len(pdf_bytes),
                    "failedPages": failed_pages,
                    "fileName": pdfFileName,
                    "userId": userId,
                    "scanSessionId": scanSessionId,
                    "metadata": metadata or {},
                },
            },
            "processingTimeMs": round((time.perf_counter() - started_at) * 1000, 2),
            "scanQualityMetadata": {
                "pageCount": len(images),
                "failedPageCount": len(failed_pages),
            },
        }
    except Exception as error:
        return {
            "success": False,
            "error": str(error),
            "processingTimeMs": round((time.perf_counter() - started_at) * 1000, 2),
        }
