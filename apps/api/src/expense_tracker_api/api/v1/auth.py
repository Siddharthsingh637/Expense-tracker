from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from expense_tracker_api.api.v1.common import DEFAULT_CATEGORIES, aware, error, token_response
from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.core.security import hash_password, hash_refresh_token, verify_password
from expense_tracker_api.models import (
    Category,
    RefreshSession,
    User,
    UserSettings,
    UserSyncState,
    utcnow,
)
from expense_tracker_api.schemas import LoginIn, RefreshIn, RegisterIn, TokenOut, UserOut

router = APIRouter(tags=["auth"])


@router.post("/auth/register", response_model=TokenOut, status_code=201)
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    if db.scalar(select(User.id).where(func.lower(User.email) == payload.email)):
        error(409, "email_exists", "An account with this email already exists")
    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    state = UserSyncState(user_id=user.id, last_sync_seq=0)
    db.add(state)
    settings = UserSettings(user_id=user.id)
    db.add(settings)
    now = utcnow()
    # Default categories use stable, client-compatible UUIDs and enter the initial pull.
    import uuid
    for order, (name, color, icon) in enumerate(DEFAULT_CATEGORIES):
        state.last_sync_seq += 1
        db.add(Category(
            id=uuid.uuid4(), user_id=user.id, name=name, color=color, icon=icon,
            type="savings" if name == "Savings" else ("fixed" if name == "Bills" else "variable"),
            is_archived=False, sort_order=order, created_at=now, updated_at=now,
            deleted_at=None, sync_seq=state.last_sync_seq,
        ))
    from expense_tracker_api.api.v1.sync import _mobile_data
    from expense_tracker_api.models import SyncChange
    state.last_sync_seq += 1
    settings.sync_seq = state.last_sync_seq
    db.flush()
    settings_data = _mobile_data(db, "user_settings", settings)
    settings_data.update({"id":str(settings.id), "_created_at":now.isoformat().replace("+00:00", "Z"),
                          "_updated_at":now.isoformat().replace("+00:00", "Z"), "_deleted_at":None})
    db.add(SyncChange(user_id=user.id, sync_seq=settings.sync_seq, resource="user_settings",
                      record_id=str(settings.id), operation="upsert", snapshot=settings_data, created_at=now))
    for category in db.scalars(select(Category).where(Category.user_id == user.id)):
        category_data = _mobile_data(db, "category", category)
        category_data.update({"_created_at":now.isoformat().replace("+00:00", "Z"),
                              "_updated_at":now.isoformat().replace("+00:00", "Z"), "_deleted_at":None})
        db.add(SyncChange(user_id=user.id, sync_seq=category.sync_seq, resource="category",
                          record_id=str(category_data["id"]), operation="upsert", snapshot=category_data, created_at=now))
    db.commit()
    db.refresh(user)
    return token_response(db, user)


@router.post("/auth/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(func.lower(User.email) == payload.email.strip().lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        error(401, "invalid_credentials", "Email or password is incorrect")
    if not user.is_active:
        error(403, "account_inactive", "Account is inactive")
    return token_response(db, user)


@router.post("/auth/refresh", response_model=TokenOut)
def refresh(payload: RefreshIn, db: Session = Depends(get_db)):
    session = db.scalar(select(RefreshSession).where(
        RefreshSession.token_hash == hash_refresh_token(payload.refresh_token)
    ))
    now = utcnow()
    if session is None or session.revoked_at is not None or aware(session.expires_at) <= now:
        error(401, "refresh_invalid_or_expired", "Refresh token is invalid or expired")
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        error(403, "account_inactive", "Account is inactive")
    # Stage 1 logout support: retain the same refresh token until expiry.
    from expense_tracker_api.core.config import ACCESS_TOKEN_MINUTES
    from expense_tracker_api.core.security import create_access_token
    return TokenOut(
        user=UserOut.model_validate(user), access_token=create_access_token(user.id, user.token_version),
        expires_in=ACCESS_TOKEN_MINUTES * 60, refresh_token=payload.refresh_token,
    )


@router.post("/auth/logout")
def logout(payload: RefreshIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.scalar(select(RefreshSession).where(
        RefreshSession.user_id == user.id,
        RefreshSession.token_hash == hash_refresh_token(payload.refresh_token),
    ))
    if session is not None:
        session.revoked_at = session.revoked_at or datetime.now(UTC)
        db.commit()
    return {"ok": True}


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
