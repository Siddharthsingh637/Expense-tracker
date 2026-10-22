from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from expense_tracker_api.core.config import ACCESS_TOKEN_MINUTES, REFRESH_TOKEN_DAYS
from expense_tracker_api.core.security import (
    create_access_token,
    hash_refresh_token,
    new_refresh_token,
)
from expense_tracker_api.models import RefreshSession, User, UserSyncState, utcnow
from expense_tracker_api.schemas import TokenOut, UserOut

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


def error(status: int, code: str, message: str, details: list[dict] | None = None) -> None:
    raise HTTPException(
        status_code=status,
        detail={"code": code, "message": message, "details": details or []},
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


def next_sync_seq(db: Session, user_id: uuid.UUID) -> int:
    state = db.scalar(
        select(UserSyncState).where(UserSyncState.user_id == user_id).with_for_update()
    )
    if state is None:
        state = UserSyncState(user_id=user_id, last_sync_seq=0)
        db.add(state)
        db.flush()
    state.last_sync_seq += 1
    db.flush()
    return state.last_sync_seq


def commit_or_conflict(db: Session, code: str = "conflict") -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        error(409, code, "The change conflicts with an existing record")


def token_response(db: Session, user: User, family_id: uuid.UUID | None = None) -> TokenOut:
    refresh_token = new_refresh_token()
    db.add(
        RefreshSession(
            user_id=user.id,
            family_id=family_id or uuid.uuid4(),
            token_hash=hash_refresh_token(refresh_token),
            expires_at=utcnow() + timedelta(days=REFRESH_TOKEN_DAYS),
        )
    )
    db.commit()
    return TokenOut(
        user=UserOut.model_validate(user),
        access_token=create_access_token(user.id, user.token_version),
        expires_in=ACCESS_TOKEN_MINUTES * 60,
        refresh_token=refresh_token,
    )


def delete_record(model, record_id: uuid.UUID, payload, user: User, db: Session):
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


def parse_month(value: str) -> date:
    try:
        return date.fromisoformat(f"{value}-01")
    except ValueError as exc:
        raise HTTPException(
            422,
            detail={"code": "validation_error", "message": "month must use YYYY-MM", "details": []},
        ) from exc
