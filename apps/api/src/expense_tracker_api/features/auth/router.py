from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.features.auth.schemas import (
    LoginIn,
    RefreshIn,
    RegisterIn,
    TokenOut,
    UserOut,
)
from expense_tracker_api.features.auth.service import (
    login_user,
    logout_user,
    refresh_user_token,
    register_user,
)
from expense_tracker_api.models import User

router = APIRouter(tags=["auth"])


@router.post("/auth/register", response_model=TokenOut, status_code=201)
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    return register_user(db, payload)


@router.post("/auth/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    return login_user(db, payload)


@router.post("/auth/refresh", response_model=TokenOut)
def refresh(payload: RefreshIn, db: Session = Depends(get_db)):
    return refresh_user_token(db, payload)


@router.post("/auth/logout")
def logout(
    payload: RefreshIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return logout_user(db, user, payload)


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
