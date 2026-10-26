from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from expense_tracker_api.schemas_v2 import (
    AskIn,
    DraftSplitIn,
    NarrativeIn,
    ParseEntryIn,
    ProposeBudgetIn,
    QueryDraft,
    ReceiptDraft,
    SuggestCategoryIn,
    TransactionDraft,
)


class CategoryDraft(BaseModel):
    model_config = {"extra": "forbid"}
    category_id: str | None


class Allocation(BaseModel):
    model_config = {"extra": "forbid"}
    category_id: str
    amount_paise: int
    reason: str


class BudgetDraft(BaseModel):
    model_config = {"extra": "forbid"}
    allocations: list[Allocation]


class SplitDraft(BaseModel):
    model_config = {"extra": "forbid"}
    title: str
    date: str
    person_ids: list[str]
    payments: dict[str, int]
    method: str
    is_settled: bool
    unmatched_names: list[str] = []


class NarrativeDraft(BaseModel):
    model_config = {"extra": "forbid"}
    text: str
    suggestions: list[str] = []


__all__ = [
    "AskIn",
    "DraftSplitIn",
    "NarrativeIn",
    "ParseEntryIn",
    "ProposeBudgetIn",
    "QueryDraft",
    "ReceiptDraft",
    "SuggestCategoryIn",
    "TransactionDraft",
    "CategoryDraft",
    "Allocation",
    "BudgetDraft",
    "SplitDraft",
    "NarrativeDraft",
]
