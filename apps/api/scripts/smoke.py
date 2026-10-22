from __future__ import annotations

import hashlib
import os
import uuid
from datetime import UTC, datetime
from io import BytesIO

import httpx
from PIL import Image


def main() -> None:
    base = os.environ.get("PAISA_API_URL", "http://127.0.0.1:8000")
    suffix = uuid.uuid4().hex[:10]
    client = httpx.Client(base_url=base, timeout=30)
    assert client.get("/health").status_code == 200
    registered = client.post("/api/v1/auth/register", json={
        "email":f"smoke-{suffix}@paisa.local","password":"paisa-smoke-password-123"
    })
    assert registered.status_code == 201, registered.text
    tokens = registered.json()
    headers = {"Authorization":f"Bearer {tokens['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    cats = client.get("/api/v1/categories", headers=headers).json()["items"]
    category_id = cats[0]["id"]
    category_now = datetime.now(UTC).isoformat()
    category_id_new = str(uuid.uuid4())
    category = client.post("/api/v1/categories", headers=headers, json={
        "id":category_id_new,"name":f"Smoke {suffix}","type":"variable","color":"#123456",
        "created_at":category_now,"updated_at":category_now,
    })
    assert category.status_code == 201, category.text
    assert client.get(f"/api/v1/categories/{category_id_new}", headers=headers).status_code == 200
    category_patch = client.patch(f"/api/v1/categories/{category_id_new}", headers=headers, json={
        "name":f"Smoke Updated {suffix}","updated_at":datetime.now(UTC).isoformat(),
    })
    assert category_patch.status_code == 200, category_patch.text
    txn_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()
    pushed = client.post("/api/v1/sync/push", headers=headers, json={"changes":[{
        "resource":"transaction","id":txn_id,"op":"upsert","updated_at":now,
        "data":{"createdAt":now,"amount":2500,"categoryId":category_id,"place":"Smoke Cafe",
                "note":"smoke","paymentMode":"upi","date":datetime.now().date().isoformat(),
                "time":"12:00","provenance":"user"}
    }]})
    assert pushed.status_code == 200 and pushed.json()["results"][0]["status"] == "applied", pushed.text
    transaction_id = str(uuid.uuid4())
    created_transaction = client.post("/api/v1/transactions", headers=headers, json={
        "id":transaction_id,"category_id":category_id,"kind":"expense","amount_paise":1250,
        "transaction_date":datetime.now(UTC).date().isoformat(),"merchant":"CRUD Cafe",
        "created_at":now,"updated_at":now,
    })
    assert created_transaction.status_code == 201, created_transaction.text
    assert client.get(f"/api/v1/transactions/{transaction_id}", headers=headers).status_code == 200
    updated_transaction = client.patch(f"/api/v1/transactions/{transaction_id}", headers=headers, json={
        "note":"smoke updated","updated_at":datetime.now(UTC).isoformat(),
    })
    assert updated_transaction.status_code == 200, updated_transaction.text
    budget_id = str(uuid.uuid4())
    budget_now = datetime.now(UTC).isoformat()
    budget = client.post("/api/v1/budgets", headers=headers, json={
        "id":budget_id,"category_id":category_id,"month":datetime.now(UTC).date().replace(day=1).isoformat(),
        "amount_paise":50000,"created_at":budget_now,"updated_at":budget_now,
    })
    assert budget.status_code == 201, budget.text
    assert client.get(f"/api/v1/budgets/{budget_id}", headers=headers).status_code == 200
    budget_patch = client.patch(f"/api/v1/budgets/{budget_id}", headers=headers, json={
        "amount_paise":60000,"updated_at":datetime.now(UTC).isoformat(),
    })
    assert budget_patch.status_code == 200, budget_patch.text
    pull = client.get("/api/v1/sync/pull?cursor=0&limit=100", headers=headers)
    assert pull.status_code == 200 and any(c["id"] == txn_id for c in pull.json()["changes"])
    ai_calls = [
        ("/api/v1/ai/parse-entry", {"text":"chai 30","context":{"timezone":"Asia/Kolkata"}}),
        ("/api/v1/ai/suggest-category", {"place":"chai","categories":[{"id":c["id"],"name":c["name"]} for c in cats]}),
        ("/api/v1/ai/propose-budget", {"total_paise":10000,"start_day":1,"history":[],"categories":[{"id":c["id"],"name":c["name"]} for c in cats]}),
        ("/api/v1/ai/draft-split", {"text":"Dinner with Riya","people":[{"id":"p1","name":"Riya"}],"categories":[]}),
        ("/api/v1/ai/ask", {"question":"How much did I spend?","categories":[],"periods":[]}),
        ("/api/v1/ai/month-narrative", {"report":{"month":"2026-10","totalSpentPaise":2500,"categoryBreakdown":[],"biggestChanges":[]},"categories":[]}),
    ]
    for path, body in ai_calls:
        response = client.post(path, headers=headers, json=body)
        assert response.status_code == 200, f"{path}: {response.text}"
        assert {"type","payload","confidence","reason","provider"} <= response.json().keys()
    image = Image.new("RGB", (24, 16), "white")
    image_bytes = BytesIO()
    image.save(image_bytes, format="PNG")
    raw = image_bytes.getvalue()
    attachment_id = str(uuid.uuid4())
    upload = client.put(f"/api/v1/attachments/{attachment_id}", headers={
        **headers,"Content-Type":"image/png","X-Transaction-ID":txn_id,
        "X-Checksum-SHA256":hashlib.sha256(raw).hexdigest(),
    }, content=raw)
    assert upload.status_code == 200, upload.text
    assert client.get(f"/api/v1/attachments/{attachment_id}", headers=headers).status_code == 200
    receipt = client.post("/api/v1/ai/parse-receipt", headers=headers, json={"attachment_id":attachment_id})
    assert receipt.status_code == 200, receipt.text
    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token":tokens["refresh_token"]})
    assert refreshed.status_code == 200, refreshed.text
    assert client.post("/api/v1/auth/logout", headers=headers,
                       json={"refresh_token":tokens["refresh_token"]}).status_code == 200
    assert client.post("/api/v1/auth/refresh", json={"refresh_token":tokens["refresh_token"]}).status_code == 401
    assert client.request("DELETE", f"/api/v1/transactions/{transaction_id}", headers=headers,
                          json={"updated_at":datetime.now(UTC).isoformat()}).status_code == 200
    assert client.request("DELETE", f"/api/v1/budgets/{budget_id}", headers=headers,
                          json={"updated_at":datetime.now(UTC).isoformat()}).status_code == 200
    assert client.request("DELETE", f"/api/v1/categories/{category_id_new}", headers=headers,
                          json={"updated_at":datetime.now(UTC).isoformat()}).status_code == 200
    print("Smoke passed: health, auth, CRUD, sync, attachment, and all seven AI endpoints.")


if __name__ == "__main__":
    main()
