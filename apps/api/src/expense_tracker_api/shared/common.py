from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from expense_tracker_api.models import User
from expense_tracker_api.shared.exceptions import error

DEFAULT_CATEGORIES = (
    ("Food", "#E67E22", "utensils"),
    ("Transport", "#3498DB", "car"),
    ("Bills", "#9B59B6", "zap"),
    ("Shopping", "#E91E63", "shopping-bag"),
    ("Health", "#2ECC71", "heart"),
    ("Entertainment", "#1ABC9C", "tv"),
    ("Rent", "#795548", "home"),
    ("Savings", "#4A7C59", "piggy-bank"),
    ("Other", "#6F675A", "more-horizontal"),
)


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def wire_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return aware(value).isoformat().replace("+00:00", "Z")
    if isinstance(value, (date, uuid.UUID)):
        return str(value)
    return value


def serialize(record: Any) -> dict[str, Any]:
    data = {column.name: getattr(record, column.name) for column in record.__table__.columns}
    return {key: wire_value(value) for key, value in data.items()}


def parse_month(value: str) -> date:
    try:
        return date.fromisoformat(f"{value}-01")
    except ValueError as exc:
        raise HTTPException(
            422,
            detail={"code": "validation_error", "message": "month must use YYYY-MM", "details": []},
        ) from exc


def delete_record(model, record_id: uuid.UUID, payload, user: User, db: Session):
    from expense_tracker_api.features.sync.service import next_sync_seq

    row = db.scalar(select(model).where(model.id == record_id, model.user_id == user.id))
    if row is None:
        error(404, "not_found", "Record not found")
    if aware(payload.updated_at) <= max(aware(row.updated_at), aware(row.created_at)):
        error(409, "stale", "A newer or equal version already exists")
    row.updated_at = payload.updated_at
    row.deleted_at = payload.updated_at
    row.sync_seq = next_sync_seq(db, user.id)
    db.commit()
    return serialize(row)
