from __future__ import annotations

import uuid
from datetime import date, datetime

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


class BudgetIn(TimestampInput):
    id: uuid.UUID
    category_id: uuid.UUID | None = None
    month: date
    amount_paise: int = Field(gt=0, le=9_223_372_036_854_775_807)
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None

    @field_validator("month")
    @classmethod
    def month_start(cls, value: date) -> date:
        if value.day != 1:
            raise ValueError("month must be the first day of the month")
        return value


class BudgetPatch(TimestampInput):
    category_id: uuid.UUID | None = None
    month: date | None = None
    amount_paise: int | None = Field(default=None, gt=0, le=9_223_372_036_854_775_807)
    updated_at: datetime

    @field_validator("month")
    @classmethod
    def month_start(cls, value: date | None) -> date | None:
        if value is not None and value.day != 1:
            raise ValueError("month must be the first day of the month")
        return value


class AllocationIn(TimestampInput):
    id: uuid.UUID
    category_id: uuid.UUID
    amount_paise: int = Field(gt=0, le=9_223_372_036_854_775_807)
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
