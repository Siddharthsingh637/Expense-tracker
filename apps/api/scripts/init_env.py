#!/usr/bin/env python3
"""Create a private local .env without overwriting developer configuration."""
from __future__ import annotations

import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / ".env.example"
TARGET = ROOT / ".env"


def main() -> None:
    if TARGET.exists():
        print(f"Keeping existing {TARGET}")
        return
    password = secrets.token_urlsafe(24)
    jwt_secret = secrets.token_urlsafe(48)
    values = EXAMPLE.read_text(encoding="utf-8")
    values = values.replace("paisa:paisa@", f"paisa:{password}@")
    values = values.replace("POSTGRES_PASSWORD=paisa", f"POSTGRES_PASSWORD={password}")
    values = values.replace("JWT_SECRET=generate-me-with-scripts-init_env", f"JWT_SECRET={jwt_secret}")
    TARGET.write_text(values, encoding="utf-8")
    TARGET.chmod(0o600)
    print(f"Created {TARGET} with local random database and JWT secrets.")


if __name__ == "__main__":
    main()
