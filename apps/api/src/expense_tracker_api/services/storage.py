from __future__ import annotations

import hashlib
import io
import uuid
from pathlib import Path
from typing import Protocol


class AttachmentStorage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


class LocalDiskStorage:
    def __init__(self, root: str | Path):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        token = uuid.UUID(key)
        return self.root / token.hex[:2] / f"{token}.img"

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_bytes(data)
        temporary.replace(path)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


def sanitize_image(raw: bytes, declared_mime: str) -> tuple[bytes, str]:
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError as exc:
        raise RuntimeError("Pillow is required to validate receipt images") from exc
    if len(raw) > 5 * 1024 * 1024:
        raise ValueError("image exceeds 5 MiB")
    Image.MAX_IMAGE_PIXELS = 30_000_000
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            fmt = (probe.format or "").upper()
            mime = {"JPEG":"image/jpeg", "PNG":"image/png", "WEBP":"image/webp"}.get(fmt)
            if mime is None or mime != declared_mime.lower():
                raise ValueError("unsupported or mismatched image type")
            probe.verify()
        with Image.open(io.BytesIO(raw)) as image:
            if image.width * image.height > 30_000_000:
                raise ValueError("image dimensions exceed limit")
            image = ImageOps.exif_transpose(image)
            output = io.BytesIO()
            if fmt == "JPEG":
                if image.mode not in ("RGB", "L"):
                    image = image.convert("RGB")
                image.save(output, format="JPEG", quality=92, optimize=True)
            elif fmt == "PNG":
                image.save(output, format="PNG", optimize=True)
            else:
                image.save(output, format="WEBP", quality=92, method=4)
            clean = output.getvalue()
            return clean, mime
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("invalid image data") from exc


def checksum(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
