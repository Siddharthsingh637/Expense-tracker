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
    serialize,
)
from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.models import Category, User
from expense_tracker_api.schemas import CategoryIn, CategoryPatch, DeleteIn

router = APIRouter(tags=["categories"])


@router.get("/categories")
def list_categories(
    include_deleted: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    stmt = select(Category).where(Category.user_id == user.id)
    if not include_deleted:
        stmt = stmt.where(Category.deleted_at.is_(None))
    return {"items": [serialize(row) for row in db.scalars(stmt.order_by(Category.name))]}


@router.post("/categories", status_code=201)
def create_category(
    payload: CategoryIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    row = Category(**payload.model_dump(), user_id=user.id, sync_seq=next_sync_seq(db, user.id))
    db.add(row)
    commit_or_conflict(db, "duplicate_name_or_id")
    db.refresh(row)
    return serialize(row)


@router.get("/categories/{record_id}")
def get_category(
    record_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    row = db.scalar(select(Category).where(Category.id == record_id, Category.user_id == user.id))
    if row is None:
        error(404, "not_found", "Category not found")
    return serialize(row)


@router.patch("/categories/{record_id}")
def patch_category(
    record_id: uuid.UUID,
    payload: CategoryPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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


@router.delete("/categories/{record_id}")
def delete_category(
    record_id: uuid.UUID,
    payload: DeleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return delete_record(Category, record_id, payload, user, db)


