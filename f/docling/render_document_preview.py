# requirements:
# requests
# pillow
# wmill

"""Private preview rendering. Never changes extraction or original files."""
import io
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

import requests
import wmill
from PIL import Image, ImageSequence

MAX_INPUT_BYTES = 25 * 1024 * 1024
MAX_OUTPUT_BYTES = 50 * 1024 * 1024
OFFICE_EXTENSIONS = {"doc", "docx", "xls", "xlsx", "pptx"}


def validate_storage_urls(file_url: str, upload_url: str):
    source, target = urlparse(file_url), urlparse(upload_url)
    for parsed in (source, target):
        if (parsed.scheme != "https" or not parsed.hostname
                or not parsed.hostname.endswith(".convex.cloud")
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or not parsed.path.startswith("/api/storage/")):
            raise ValueError("Only Convex storage URLs are accepted.")
    if source.hostname != target.hostname:
        raise ValueError("Source and output storage must belong to the same deployment.")


def read_bounded(response, limit: int, deadline: float) -> bytes:
    if response.status_code != 200:
        raise ValueError("Preview file transfer or conversion failed.")
    output = io.BytesIO()
    for chunk in response.iter_content(65536):
        if time.monotonic() > deadline:
            raise ValueError("Preview conversion timed out.")
        if output.tell() + len(chunk) > limit:
            raise ValueError("The preview exceeds the supported file size.")
        output.write(chunk)
    return output.getvalue()


def tiff_to_pdf(payload: bytes) -> bytes:
    frames = []
    pixels = 0
    try:
        with Image.open(io.BytesIO(payload)) as source:
            for frame in ImageSequence.Iterator(source):
                pixels += frame.width * frame.height
                if len(frames) >= 200 or pixels > 100_000_000:
                    raise ValueError("TIFF exceeds the supported preview page/pixel limit.")
                frames.append(frame.convert("RGB"))
        if not frames:
            raise ValueError("TIFF contains no pages.")
        output = io.BytesIO()
        frames[0].save(output, format="PDF", save_all=True, append_images=frames[1:], resolution=150.0)
        return output.getvalue()
    finally:
        for frame in frames:
            frame.close()


def main(file_url: str, filename: str, upload_url: str):
    validate_storage_urls(file_url, upload_url)
    extension = filename.rsplit(".", 1)[-1].lower()
    if extension not in OFFICE_EXTENSIONS | {"tif", "tiff"}:
        raise ValueError("Unsupported preview format.")
    deadline = time.monotonic() + 240
    try:
        with requests.get(file_url, stream=True, timeout=(10, 30), allow_redirects=False) as response:
            payload = read_bounded(response, MAX_INPUT_BYTES, deadline)
        if extension in {"tif", "tiff"}:
            pdf = tiff_to_pdf(payload)
        else:
            converter = wmill.get_variable("f/docling/PREVIEW_GOTENBERG_URL").rstrip("/")
            username = wmill.get_variable("f/docling/PREVIEW_GOTENBERG_USERNAME")
            password = wmill.get_variable("f/docling/PREVIEW_GOTENBERG_PASSWORD")
            if not converter or not username or not password:
                raise ValueError("Private preview conversion is not configured.")
            # Fixed endpoint; users never supply converter URLs or arbitrary form fields.
            with TemporaryDirectory(prefix="document-preview-") as directory:
                source = Path(directory) / f"document.{extension}"
                source.write_bytes(payload)
                with source.open("rb") as document:
                    with requests.post(
                        f"{converter}/forms/libreoffice/convert",
                        files={"files": (source.name, document)},
                        data={"updateIndexes": "false", "exportFormFields": "false"},
                        auth=(username, password), stream=True, timeout=(10, 180), allow_redirects=False,
                    ) as response:
                        pdf = read_bounded(response, MAX_OUTPUT_BYTES, deadline)
        if len(pdf) > MAX_OUTPUT_BYTES or not pdf.startswith(b"%PDF-"):
            raise ValueError("Conversion did not produce a supported PDF preview.")
        if time.monotonic() > deadline:
            raise ValueError("Preview conversion timed out.")
        with requests.post(upload_url, data=pdf, headers={"Content-Type": "application/pdf"},
                           timeout=(10, 30), allow_redirects=False) as response:
            if response.status_code != 200:
                raise ValueError("The preview could not be saved.")
            storage_id = response.json().get("storageId")
            if not isinstance(storage_id, str) or not storage_id:
                raise ValueError("The preview upload was not confirmed.")
        return {"storage_id": storage_id}
    except requests.RequestException:
        # Requests exceptions can contain signed URLs; never include them in job logs.
        raise ValueError("Preview transfer or conversion failed.") from None
