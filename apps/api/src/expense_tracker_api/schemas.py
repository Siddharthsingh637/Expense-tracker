from __future__ import annotations

import re
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


class RegisterIn(InputModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address")
        return value


class EmailIn(InputModel):
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address")
        return value


class ActionTokenIn(InputModel):
    token: str = Field(min_length=32, max_length=256)


class PasswordResetIn(ActionTokenIn):
    new_password: str = Field(min_length=12, max_length=128)


class PasswordChangeIn(InputModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class GoogleLoginIn(InputModel):
    id_token: str = Field(min_length=32, max_length=8192)


class LoginIn(InputModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address")
        return value


class RefreshIn(InputModel):
    refresh_token: str = Field(min_length=32, max_length=256)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    role: str
    is_active: bool
    created_at: datetime


class TokenOut(BaseModel):
    user: UserOut
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: str


class RegistrationOut(BaseModel):
    user: UserOut
    verification_required: bool
    access_token: str | None = None
    token_type: str | None = None
    expires_in: int | None = None
    refresh_token: str | None = None


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

    @field_validator("category_id", "kind", "amount_paise", "transaction_date")
    @classmethod
    def required_fields_not_null(cls, value):
        if value is None:
            raise ValueError("field cannot be null")
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


class DeleteIn(TimestampInput):
    updated_at: datetime


class SyncChange(InputModel):
    entity: Literal["category", "transaction", "budget"]
    record: dict


class SyncPushIn(InputModel):
    changes: list[SyncChange] = Field(max_length=500)
