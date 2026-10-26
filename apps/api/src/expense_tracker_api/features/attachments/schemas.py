from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PresignIn(InputModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(pattern=r"^image/(jpeg|png|webp|heic)$")
    size_bytes: int = Field(gt=0, le=10 * 1024 * 1024)


class CompleteIn(InputModel):
    storage_key: str = Field(min_length=1, max_length=512)
    transaction_id: uuid.UUID | None = None
