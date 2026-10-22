from tests.helpers import (
    auth_headers,
    budget_payload,
    category_payload,
    register,
    transaction_payload,
)


def test_user_a_cannot_read_edit_or_delete_user_b_category(client):
    user_a = register(client, "a@example.com")
    user_b = register(client, "b@example.com")
    created = client.post(
        "/api/v1/categories", headers=auth_headers(user_b), json=category_payload("Private")
    )
    assert created.status_code == 201
    category = created.json()

    headers_a = auth_headers(user_a)
    assert client.get(f"/api/v1/categories/{category['id']}", headers=headers_a).status_code == 404
    assert client.patch(
        f"/api/v1/categories/{category['id']}",
        headers=headers_a,
        json={"name": "Stolen", "updated_at": "2026-10-22T00:00:00Z"},
    ).status_code == 404
    assert client.request(
        "DELETE",
        f"/api/v1/categories/{category['id']}",
        headers=headers_a,
        json={"updated_at": "2026-10-22T00:00:00Z"},
    ).status_code == 404
    assert client.get(f"/api/v1/categories/{category['id']}", headers=auth_headers(user_b)).status_code == 200


def test_user_a_cannot_read_edit_or_delete_user_b_transaction(client):
    user_a = register(client, "a@example.com")
    user_b = register(client, "b@example.com")
    b_categories = client.get("/api/v1/categories", headers=auth_headers(user_b)).json()["items"]
    category_id = b_categories[0]["id"]
    created = client.post(
        "/api/v1/transactions",
        headers=auth_headers(user_b),
        json=transaction_payload(category_id),
    )
    assert created.status_code == 201, created.text
    record = created.json()
    headers_a = auth_headers(user_a)
    assert client.get(f"/api/v1/transactions/{record['id']}", headers=headers_a).status_code == 404
    assert client.patch(
        f"/api/v1/transactions/{record['id']}",
        headers=headers_a,
        json={"note": "changed", "updated_at": "2026-10-22T00:00:00Z"},
    ).status_code == 404
    assert client.request(
        "DELETE",
        f"/api/v1/transactions/{record['id']}",
        headers=headers_a,
        json={"updated_at": "2026-10-22T00:00:00Z"},
    ).status_code == 404
    assert client.get(f"/api/v1/transactions/{record['id']}", headers=auth_headers(user_b)).status_code == 200


def test_user_a_cannot_read_edit_or_delete_user_b_budget(client):
    user_a = register(client, "a@example.com")
    user_b = register(client, "b@example.com")
    b_category = client.get("/api/v1/categories", headers=auth_headers(user_b)).json()["items"][0]
    created = client.post(
        "/api/v1/budgets",
        headers=auth_headers(user_b),
        json=budget_payload(b_category["id"]),
    )
    assert created.status_code == 201, created.text
    record = created.json()
    headers_a = auth_headers(user_a)
    assert client.get(f"/api/v1/budgets/{record['id']}", headers=headers_a).status_code == 404
    assert client.patch(
        f"/api/v1/budgets/{record['id']}",
        headers=headers_a,
        json={"amount_paise": 100, "updated_at": "2026-10-22T00:00:00Z"},
    ).status_code == 404
    assert client.request(
        "DELETE",
        f"/api/v1/budgets/{record['id']}",
        headers=headers_a,
        json={"updated_at": "2026-10-22T00:00:00Z"},
    ).status_code == 404
    assert client.get("/api/v1/budgets?month=2026-10", headers=auth_headers(user_b)).json()["items"]


def test_transaction_filtering_and_pagination(client):
    tokens = register(client)
    headers = auth_headers(tokens)
    category_id = client.get("/api/v1/categories", headers=headers).json()["items"][0]["id"]
    rows = [
        transaction_payload(category_id, amount_paise=amount, merchant=merchant, transaction_date=day)
        for amount, merchant, day in [
            (100, "Tea stand", "2026-10-01"),
            (200, "Bus", "2026-10-02"),
            (300, "Tea shop", "2026-10-03"),
        ]
    ]
    for row in rows:
        assert client.post("/api/v1/transactions", headers=headers, json=row).status_code == 201
    response = client.get(
        "/api/v1/transactions?from=2026-10-02&to=2026-10-03&q=tea&page=1&page_size=1",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["merchant"] == "Tea shop"
