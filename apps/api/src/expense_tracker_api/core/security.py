from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid

from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError

from expense_tracker_api.core.config import ACCESS_TOKEN_MINUTES, JWT_SECRET

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    try:
        return password_hash.verify(password, encoded)
    except (ValueError, TypeError, UnknownHashError):
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def create_access_token(user_id: uuid.UUID, token_version: int = 0) -> str:
    now = int(time.time())
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(
        json.dumps(
            {
                "sub": str(user_id),
                "ver": token_version,
                "iat": now,
                "exp": now + ACCESS_TOKEN_MINUTES * 60,
            },
            separators=(",", ":"),
        ).encode()
    )
    message = f"{header}.{payload}"
    signature = _b64(hmac.new(JWT_SECRET.encode(), message.encode(), hashlib.sha256).digest())
    return f"{message}.{signature}"


def decode_access_token(token: str) -> tuple[uuid.UUID, int]:
    try:
        header, payload, signature = token.split(".")
        decoded_header = json.loads(base64.urlsafe_b64decode(header + "=" * (-len(header) % 4)))
        if decoded_header.get("alg") != "HS256":
            raise ValueError
        message = f"{header}.{payload}"
        expected = _b64(hmac.new(JWT_SECRET.encode(), message.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        decoded = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if decoded.get("exp", 0) <= int(time.time()):
            raise ValueError
        return uuid.UUID(decoded["sub"]), int(decoded.get("ver", 0))
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid token") from exc


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
