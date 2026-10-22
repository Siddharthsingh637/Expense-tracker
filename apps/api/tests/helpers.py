import uuid
from datetime import UTC, datetime, timedelta

PASSWORD = "local-test-password-123"


def register(client, email: str = "person@example.com") -> dict:
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return response.json()


def auth_headers(token_response: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {token_response['access_token']}"}


def timestamp(offset_seconds: int = 0) -> str:
    return (datetime.now(UTC) + timedelta(seconds=offset_seconds)).isoformat().replace("+00:00", "Z")


def category_payload(name: str = "Custom", **overrides) -> dict:
    now = timestamp()
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "color": "#abcdef",
        "icon": "tag",
        "created_at": now,
        "updated_at": now,
        **overrides,
    }


def transaction_payload(category_id: str, **overrides) -> dict:
    now = timestamp()
    return {
        "id": str(uuid.uuid4()),
        "category_id": category_id,
        "kind": "expense",
        "amount_paise": 1250,
        "transaction_date": "2026-10-01",
        "merchant": "Tea shop",
        "note": "morning chai",
        "created_at": now,
        "updated_at": now,
        **overrides,
    }


def budget_payload(category_id: str | None = None, **overrides) -> dict:
    now = timestamp()
    return {
        "id": str(uuid.uuid4()),
        "category_id": category_id,
        "month": "2026-10-01",
        "amount_paise": 50000,
        "created_at": now,
        "updated_at": now,
        **overrides,
    }
