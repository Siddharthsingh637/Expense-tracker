from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from expense_tracker_api.api.v1.common import (
    aware,
    commit_or_conflict,
    delete_record,
    error,
    next_sync_seq,
    parse_month,
    serialize,
)
from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.models import Budget, Category, User
from expense_tracker_api.schemas import BudgetIn, BudgetPatch, DeleteIn

router = APIRouter(tags=["budgets"])


@router.get("/budgets")
def list_budgets(
    month: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    stmt = select(Budget).where(Budget.user_id == user.id, Budget.deleted_at.is_(None))
    if month:
        month = parse_month(month)
        stmt = stmt.where(Budget.month == month)
    return {
        "items": [
            serialize(row)
            for row in db.scalars(stmt.order_by(Budget.month.desc(), Budget.category_id))
        ]
    }


@router.post("/budgets", status_code=201)
def create_budget(
    payload: BudgetIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if (
        payload.category_id is not None
        and db.scalar(
            select(Category.id).where(
                Category.id == payload.category_id,
                Category.user_id == user.id,
                Category.deleted_at.is_(None),
            )
        )
        is None
    ):
        error(404, "category_not_found", "Category not found")
    row = Budget(**payload.model_dump(), user_id=user.id, sync_seq=next_sync_seq(db, user.id))
    db.add(row)
    commit_or_conflict(db, "budget_exists")
    return serialize(row)


@router.get("/budgets/{record_id}")
def get_budget(
    record_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    row = db.scalar(select(Budget).where(Budget.id == record_id, Budget.user_id == user.id))
    if row is None:
        error(404, "not_found", "Budget not found")
    return serialize(row)


@router.patch("/budgets/{record_id}")
def patch_budget(
    record_id: uuid.UUID,
    payload: BudgetPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.scalar(select(Budget).where(Budget.id == record_id, Budget.user_id == user.id))
    if row is None:
        error(404, "not_found", "Budget not found")
    if aware(payload.updated_at) <= max(aware(row.updated_at), aware(row.created_at)):
        error(409, "stale", "A newer or equal version already exists")
    values = payload.model_dump(exclude={"updated_at"}, exclude_unset=True)
    category_id = values.get("category_id", row.category_id)
    if (
        category_id is not None
        and db.scalar(
            select(Category.id).where(Category.id == category_id, Category.user_id == user.id)
        )
        is None
    ):
        error(404, "category_not_found", "Category not found")
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = payload.updated_at
    row.sync_seq = next_sync_seq(db, user.id)
    commit_or_conflict(db, "budget_exists")
    return serialize(row)


@router.delete("/budgets/{record_id}")
def delete_budget(
    record_id: uuid.UUID,
    payload: DeleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return delete_record(Budget, record_id, payload, user, db)


