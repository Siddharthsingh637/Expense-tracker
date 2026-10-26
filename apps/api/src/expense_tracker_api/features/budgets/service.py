from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from expense_tracker_api.features.budgets.schemas import BudgetIn, BudgetPatch, DeleteIn
from expense_tracker_api.features.sync.service import next_sync_seq
from expense_tracker_api.models import Budget, Category, User
from expense_tracker_api.shared.common import aware, delete_record, parse_month, serialize
from expense_tracker_api.shared.exceptions import commit_or_conflict, error


def list_budgets_service(
    db: Session, user: User, month: str | None = None
) -> dict[str, Any]:
    stmt = select(Budget).where(Budget.user_id == user.id, Budget.deleted_at.is_(None))
    if month:
        parsed_m = parse_month(month)
        stmt = stmt.where(Budget.month == parsed_m)
    return {
        "items": [
            serialize(row)
            for row in db.scalars(stmt.order_by(Budget.month.desc(), Budget.category_id))
        ]
    }


def create_budget_service(
    db: Session, user: User, payload: BudgetIn
) -> dict[str, Any]:
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


def get_budget_service(
    db: Session, user: User, record_id: uuid.UUID
) -> dict[str, Any]:
    row = db.scalar(select(Budget).where(Budget.id == record_id, Budget.user_id == user.id))
    if row is None:
        error(404, "not_found", "Budget not found")
    return serialize(row)


def patch_budget_service(
    db: Session, user: User, record_id: uuid.UUID, payload: BudgetPatch
) -> dict[str, Any]:
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


def delete_budget_service(
    db: Session, user: User, record_id: uuid.UUID, payload: DeleteIn
) -> dict[str, Any]:
    return delete_record(Budget, record_id, payload, user, db)
