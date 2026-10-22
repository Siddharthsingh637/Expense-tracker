from collections.abc import Generator

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from expense_tracker_api.core.security import decode_access_token
from expense_tracker_api.db.session import SessionLocal
from expense_tracker_api.models import User

bearer = HTTPBearer(auto_error=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(401, "Authentication required", headers={"WWW-Authenticate": "Bearer"})
    try:
        user_id, token_version = decode_access_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(
            401, "Invalid or expired access token", headers={"WWW-Authenticate": "Bearer"}
        ) from exc
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(401, "Invalid or expired access token")
    if user.token_version != token_version:
        raise HTTPException(401, "Access token has been revoked")
    if not user.is_active:
        raise HTTPException(403, "Account is inactive")
    return user
