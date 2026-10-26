from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PersonIn(InputModel):
    id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    upi_id: str | None = Field(default=None, max_length=120)
    is_me: bool = False
    is_archived: bool = False
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class GroupBillIn(InputModel):
    id: uuid.UUID
    title: str = Field(min_length=1, max_length=200)
    total_paise: int = Field(gt=0)
    payer_person_id: uuid.UUID
    category_id: uuid.UUID | None = None
    split_type: Literal["equal", "custom", "percent", "shares"] = "equal"
    person_ids: list[str] = Field(default_factory=list)
    custom_shares: dict[str, int] | None = None
    percent_shares: dict[str, float] | None = None
    share_weights: dict[str, int] | None = None
    tax_paise: int = 0
    tip_paise: int = 0
    bill_date: date
    is_settled: bool = False
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class SettlementIn(InputModel):
    id: uuid.UUID
    group_bill_id: uuid.UUID | None = None
    from_person_id: uuid.UUID
    to_person_id: uuid.UUID
    amount_paise: int = Field(gt=0)
    paid_amount_paise: int = 0
    is_paid: bool = False
    paid_at: datetime | None = None
    voided_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
