from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


def error(status: int, code: str, message: str, details: list[dict] | None = None) -> None:
    raise HTTPException(
        status_code=status,
        detail={"code": code, "message": message, "details": details or []},
    )


def commit_or_conflict(db: Session, code: str = "conflict") -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        error(409, code, "The change conflicts with an existing record")
