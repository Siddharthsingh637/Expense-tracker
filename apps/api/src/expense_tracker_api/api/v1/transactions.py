from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from expense_tracker_api.api.v1.common import (
    aware,
    commit_or_conflict,
    delete_record,
    error,
    next_sync_seq,
    serialize,
)
from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.models import Category, Transaction, User
from expense_tracker_api.schemas import DeleteIn, TransactionIn, TransactionPatch

router = APIRouter(tags=["transactions"])


@router.get("/transactions")
def list_transactions(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    category_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100),
    kind: str | None = Query(default=None, pattern="^(expense|income)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    sort: str = Query(default="date_desc", pattern="^(date_desc|date_asc)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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


@router.post("/transactions", status_code=201)
def create_transaction(
    payload: TransactionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
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


@router.get("/transactions/{record_id}")
def get_transaction(
    record_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    row = db.scalar(
        select(Transaction).where(Transaction.id == record_id, Transaction.user_id == user.id)
    )
    if row is None:
        error(404, "not_found", "Transaction not found")
    return serialize(row)


@router.patch("/transactions/{record_id}")
def patch_transaction(
    record_id: uuid.UUID,
    payload: TransactionPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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


@router.delete("/transactions/{record_id}")
def delete_transaction(
    record_id: uuid.UUID,
    payload: DeleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return delete_record(Transaction, record_id, payload, user, db)


