from datetime import UTC, datetime

from expense_tracker_api.core.security import create_access_token
from expense_tracker_api.models import User
from tests.helpers import PASSWORD, auth_headers, register


def test_register_seeds_default_categories_and_issues_tokens(client):
    tokens = register(client)
    assert tokens["token_type"] == "bearer"
    assert tokens["refresh_token"]
    assert client.get("/api/v1/auth/me", headers=auth_headers(tokens)).status_code == 200

    response = client.get("/api/v1/categories", headers=auth_headers(tokens))
    assert response.status_code == 200
    assert {item["name"] for item in response.json()["items"]} == {
        "Food",
        "Transport",
        "Bills",
        "Shopping",
        "Health",
        "Entertainment",
        "Rent",
        "Savings",
        "Other",
    }


def test_duplicate_email_is_case_insensitive(client):
    register(client, "person@example.com")
    response = client.post(
        "/api/v1/auth/register", json={"email": "PERSON@example.com", "password": PASSWORD}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_exists"


def test_login_rejects_wrong_password(client):
    register(client)
    response = client.post(
        "/api/v1/auth/login", json={"email": "person@example.com", "password": "wrong-password"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"


def test_invalid_and_expired_tokens_are_rejected(client, monkeypatch):
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    now = datetime.now(UTC).timestamp()
    monkeypatch.setattr("expense_tracker_api.core.security.time.time", lambda: now - 7200)
    expired = create_access_token(__import__("uuid").uuid4())
    monkeypatch.undo()
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401


def test_inactive_account_cannot_use_access_token(client, db_session):
    tokens = register(client)
    user = db_session.query(User).filter_by(email="person@example.com").one()
    user.is_active = False
    db_session.commit()
    response = client.get("/api/v1/auth/me", headers=auth_headers(tokens))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_logout_revokes_refresh_token(client):
    tokens = register(client)
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    new_tokens = refreshed.json()
    assert new_tokens["refresh_token"] == tokens["refresh_token"]
    logout = client.post(
        "/api/v1/auth/logout",
        headers=auth_headers(new_tokens),
        json={"refresh_token": new_tokens["refresh_token"]},
    )
    assert logout.status_code == 200
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": new_tokens["refresh_token"]}).status_code == 401


