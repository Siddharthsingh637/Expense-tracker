from __future__ import annotations

import uuid
from datetime import date as Date
from datetime import datetime, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StrictOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SyncChangeIn(StrictInput):
    resource: Literal[
        "category", "transaction", "budget_period", "budget_allocation", "budget_transfer",
        "person", "group_bill", "settlement", "attachment", "user_settings", "place_rule",
    ]
    id: str = Field(min_length=1, max_length=80)
    op: Literal["upsert", "delete"]
    updated_at: datetime
    data: dict[str, Any] = Field(default_factory=dict)
    group_id: str | None = Field(default=None, max_length=80)

    @field_validator("updated_at")
    @classmethod
    def aware_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("updated_at must include timezone")
        return value


class SyncPushV2(StrictInput):
    changes: list[SyncChangeIn] = Field(max_length=500)


class ParseEntryIn(StrictInput):
    text: str = Field(min_length=1, max_length=4000)
    context: dict[str, Any] = Field(default_factory=dict)


class SuggestCategoryIn(StrictInput):
    place: str = Field(min_length=1, max_length=200)
    categories: list[dict[str, Any]] = Field(max_length=200)


class ProposeBudgetIn(StrictInput):
    total_paise: int = Field(ge=0, le=9_223_372_036_854_775_807)
    start_day: int = Field(ge=1, le=28)
    history: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    categories: list[dict[str, Any]] = Field(max_length=200)


class DraftSplitIn(StrictInput):
    text: str = Field(min_length=1, max_length=4000)
    people: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    categories: list[dict[str, Any]] = Field(default_factory=list, max_length=200)


class AskIn(StrictInput):
    question: str = Field(min_length=1, max_length=2000)
    categories: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    periods: list[dict[str, Any]] = Field(default_factory=list, max_length=36)


class NarrativeIn(StrictInput):
    report: dict[str, Any]
    categories: list[dict[str, Any]] = Field(default_factory=list)


class ReceiptDraft(StrictOutput):
    merchant: str | None = None
    total_paise: int | None = Field(default=None, ge=0)
    date: Date | None = None
    items: list[dict[str, Any]] = Field(default_factory=list)


class TransactionDraft(StrictOutput):
    amount_paise: int | None = Field(default=None, gt=0)
    place: str = ""
    note: str = ""
    payment_mode: Literal["cash", "upi", "card"] | None = None
    local_date: Date | None = None
    local_time: time | None = None
    kind: Literal["expense", "income", "refund"] = "expense"
    category_id: uuid.UUID | None = None


class QueryFilters(StrictOutput):
    payment_mode: Literal["cash", "upi", "card"] | None = None
    place: str | None = None
    kind: Literal["expense", "income", "refund"] | None = None


class QueryDraft(StrictOutput):
    intent: Literal["spending_total", "category_total", "budget_remaining", "transaction_count", "comparison", "unknown"]
    category_id: uuid.UUID | None = None
    period: dict[str, Date] | None = None
    filters: QueryFilters = Field(default_factory=QueryFilters)

