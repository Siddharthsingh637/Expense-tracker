from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from expense_tracker_api.features.expenses.schemas import (
    CategoryIn,
    CategoryPatch,
    DeleteIn,
    TransactionIn,
    TransactionPatch,
)
from expense_tracker_api.features.sync.service import next_sync_seq
from expense_tracker_api.models import Category, Transaction, User
from expense_tracker_api.shared.common import aware, delete_record, serialize
from expense_tracker_api.shared.exceptions import commit_or_conflict, error


# --- Category Operations ---

def list_categories_service(db: Session, user: User, include_deleted: bool = False) -> dict[str, Any]:
    stmt = select(Category).where(Category.user_id == user.id)
    if not include_deleted:
        stmt = stmt.where(Category.deleted_at.is_(None))
    return {"items": [serialize(row) for row in db.scalars(stmt.order_by(Category.name))]}


def create_category_service(db: Session, user: User, payload: CategoryIn) -> dict[str, Any]:
    row = Category(**payload.model_dump(), user_id=user.id, sync_seq=next_sync_seq(db, user.id))
    db.add(row)
    commit_or_conflict(db, "duplicate_name_or_id")
    db.refresh(row)
    return serialize(row)


def get_category_service(db: Session, user: User, record_id: uuid.UUID) -> dict[str, Any]:
    row = db.scalar(select(Category).where(Category.id == record_id, Category.user_id == user.id))
    if row is None:
        error(404, "not_found", "Category not found")
    return serialize(row)


def patch_category_service(
    db: Session, user: User, record_id: uuid.UUID, payload: CategoryPatch
) -> dict[str, Any]:
    row = db.scalar(select(Category).where(Category.id == record_id, Category.user_id == user.id))
    if row is None:
        error(404, "not_found", "Category not found")
    if aware(payload.updated_at) <= max(aware(row.updated_at), aware(row.created_at)):
        error(409, "stale", "A newer or equal version already exists")
    for key, value in payload.model_dump(exclude={"updated_at"}, exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_at = payload.updated_at
    row.sync_seq = next_sync_seq(db, user.id)
    commit_or_conflict(db, "duplicate_name_or_id")
    return serialize(row)


def delete_category_service(
    db: Session, user: User, record_id: uuid.UUID, payload: DeleteIn
) -> dict[str, Any]:
    return delete_record(Category, record_id, payload, user, db)


# --- Transaction Operations ---

def list_transactions_service(
    db: Session,
    user: User,
    from_date: date | None = None,
    to_date: date | None = None,
    category_id: uuid.UUID | None = None,
    q: str | None = None,
    kind: str | None = None,
    page: int = 1,
    page_size: int = 50,
    sort: str = "date_desc",
) -> dict[str, Any]:
    if from_date and to_date and from_date > to_date:
        error(400, "invalid_date_range", "from must be on or before to")
    stmt = select(Transaction).where(
        Transaction.user_id == user.id, Transaction.deleted_at.is_(None)
    )
    if from_date:
        stmt = stmt.where(Transaction.transaction_date >= from_date)
    if to_date:
        stmt = stmt.where(Transaction.transaction_date <= to_date)
    if category_id:
        stmt = stmt.where(Transaction.category_id == category_id)
    if kind:
        stmt = stmt.where(Transaction.kind == kind)
    if q:
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Transaction.merchant.ilike(term), Transaction.note.ilike(term)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = (
        Transaction.transaction_date.desc()
        if sort == "date_desc"
        else Transaction.transaction_date.asc()
    )
    items = db.scalars(
        stmt.order_by(order, Transaction.id).offset((page - 1) * page_size).limit(page_size)
    )
    return {
        "items": [serialize(row) for row in items],
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": (total + page_size - 1) // page_size,
    }


def create_transaction_service(
    db: Session, user: User, payload: TransactionIn
) -> dict[str, Any]:
    category = db.scalar(
        select(Category.id).where(
            Category.id == payload.category_id,
            Category.user_id == user.id,
            Category.deleted_at.is_(None),
        )
    )
    if category is None:
        error(404, "category_not_found", "Category not found")
    row = Transaction(**payload.model_dump(), user_id=user.id, sync_seq=next_sync_seq(db, user.id))
    db.add(row)
    commit_or_conflict(db, "duplicate_id")
    return serialize(row)


def get_transaction_service(
    db: Session, user: User, record_id: uuid.UUID
) -> dict[str, Any]:
    row = db.scalar(
        select(Transaction).where(Transaction.id == record_id, Transaction.user_id == user.id)
    )
    if row is None:
        error(404, "not_found", "Transaction not found")
    return serialize(row)


def patch_transaction_service(
    db: Session, user: User, record_id: uuid.UUID, payload: TransactionPatch
) -> dict[str, Any]:
    row = db.scalar(
        select(Transaction).where(Transaction.id == record_id, Transaction.user_id == user.id)
    )
    if row is None:
        error(404, "not_found", "Transaction not found")
    if aware(payload.updated_at) <= max(aware(row.updated_at), aware(row.created_at)):
        error(409, "stale", "A newer or equal version already exists")
    values = payload.model_dump(exclude={"updated_at"}, exclude_unset=True)
    target_category = values.get("category_id", row.category_id)
    if (
        target_category is not None
        and db.scalar(
            select(Category.id).where(
                Category.id == target_category,
                Category.user_id == user.id,
                Category.deleted_at.is_(None),
            )
        )
        is None
    ):
        error(404, "category_not_found", "Category not found")
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = payload.updated_at
    row.sync_seq = next_sync_seq(db, user.id)
    commit_or_conflict(db)
    return serialize(row)


def delete_transaction_service(
    db: Session, user: User, record_id: uuid.UUID, payload: DeleteIn
) -> dict[str, Any]:
    return delete_record(Transaction, record_id, payload, user, db)
