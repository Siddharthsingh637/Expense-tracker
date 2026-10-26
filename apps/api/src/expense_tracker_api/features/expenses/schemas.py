from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TimestampInput(InputModel):
    @model_validator(mode="after")
    def timestamps_are_aware(self):
        for key in ("created_at", "updated_at", "deleted_at"):
            value = getattr(self, key, None)
            if value is not None and (value.tzinfo is None or value.utcoffset() is None):
                raise ValueError(f"{key} must include a UTC offset")
        created = getattr(self, "created_at", None)
        updated = getattr(self, "updated_at", None)
        if created and updated and updated < created:
            raise ValueError("updated_at must not be earlier than created_at")
        return self


class DeleteIn(InputModel):
    updated_at: datetime

    @field_validator("updated_at")
    @classmethod
    def updated_at_is_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("updated_at must include a UTC offset")
        return value


class CategoryIn(TimestampInput):
    id: uuid.UUID
    name: str = Field(min_length=1, max_length=60)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: str | None = Field(default=None, max_length=40)
    type: Literal["fixed", "variable", "savings"] = "variable"
    is_archived: bool = False
    sort_order: int = 0
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class CategoryPatch(TimestampInput):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: str | None = Field(default=None, max_length=40)
    type: Literal["fixed", "variable", "savings"] | None = None
    is_archived: bool | None = None
    sort_order: int | None = None
    updated_at: datetime

    @field_validator("name")
    @classmethod
    def name_not_null(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("name cannot be null")
        return value


class TransactionIn(TimestampInput):
    id: uuid.UUID
    category_id: uuid.UUID
    kind: Literal["expense", "income", "refund"]
    amount_paise: int = Field(gt=0, le=9_223_372_036_854_775_807)
    transaction_date: date
    merchant: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    place: str = Field(default="", max_length=120)
    payment_mode: Literal["cash", "upi", "card"] = "cash"
    local_time: str = "00:00:00"
    timezone: str = "UTC"
    provenance: Literal["user", "ai_confirmed", "ai_edited"] = "user"
    group_bill_id: uuid.UUID | None = None
    attachment_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class TransactionPatch(TimestampInput):
    category_id: uuid.UUID | None = None
    kind: Literal["expense", "income", "refund"] | None = None
    amount_paise: int | None = Field(default=None, gt=0, le=9_223_372_036_854_775_807)
    transaction_date: date | None = None
    merchant: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    place: str | None = Field(default=None, max_length=120)
    payment_mode: Literal["cash", "upi", "card"] | None = None
    local_time: str | None = None
    timezone: str | None = None
    provenance: Literal["user", "ai_confirmed", "ai_edited"] | None = None
    group_bill_id: uuid.UUID | None = None
    attachment_id: uuid.UUID | None = None
    updated_at: datetime
