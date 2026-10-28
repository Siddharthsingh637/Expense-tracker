from __future__ import annotations

import hashlib
import io
import uuid

from PIL import Image
from PIL.TiffImagePlugin import IFDRational

from expense_tracker_api.api.v1 import attachments as attachment_api
from tests.helpers import auth_headers, register


def _jpeg(with_exif: bool = False) -> bytes:
    image = Image.new("RGB", (12, 8), color=(220, 80, 30))
    output = io.BytesIO()
    if with_exif:
        exif = Image.Exif()
        exif[315] = "Financer test receipt"
        exif[34853] = {1: "N", 2: (IFDRational(12,1), IFDRational(34,1), IFDRational(56,1)),
                        3: "E", 4: (IFDRational(77,1), IFDRational(12,1), IFDRational(1,1))}
        image.save(output, format="JPEG", exif=exif)
    else:
        image.save(output, format="JPEG")
    return output.getvalue()


def _transaction(client, headers):
    category_id = client.get("/api/v1/categories", headers=headers).json()["items"][0]["id"]
    now = "2026-10-22T12:00:00Z"
    response = client.post("/api/v1/transactions", headers=headers, json={
        "id":str(uuid.uuid4()),"category_id":category_id,"kind":"expense","amount_paise":1000,
        "transaction_date":"2026-10-22","created_at":now,"updated_at":now,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _upload(client, headers, txn_id, attachment_id, data):
    return client.put(f"/api/v1/attachments/{attachment_id}", headers={
        **headers,"Content-Type":"image/jpeg","X-Transaction-ID":txn_id,
        "X-Checksum-SHA256":hashlib.sha256(data).hexdigest(),
    }, content=data)


def test_attachment_is_decoded_sanitized_private_and_retry_safe(client, monkeypatch, tmp_path):
    monkeypatch.setattr(attachment_api, "ATTACHMENT_DIR", str(tmp_path))
    a_headers = auth_headers(register(client, "photo-owner@example.com"))
    b_headers = auth_headers(register(client, "photo-stranger@example.com"))
    transaction_id, attachment_id = _transaction(client, a_headers), str(uuid.uuid4())
    original = _jpeg(with_exif=True)
    response = _upload(client, a_headers, transaction_id, attachment_id, original)
    assert response.status_code == 200, response.text
    assert response.json()["upload_status"] == "uploaded"
    result = client.get(f"/api/v1/attachments/{attachment_id}", headers=a_headers)
    assert result.status_code == 200
    assert result.headers["cache-control"] == "private, no-store"
    assert result.headers["x-content-type-options"] == "nosniff"
    with Image.open(io.BytesIO(result.content)) as image:
        assert not image.getexif()
    retry = _upload(client, a_headers, transaction_id, attachment_id, original)
    assert retry.status_code == 200
    assert retry.json()["checksum_sha256"] == response.json()["checksum_sha256"]
    original_txn = client.get(f"/api/v1/transactions/{transaction_id}", headers=a_headers).json()
    linked = client.post("/api/v1/sync/push", headers=a_headers, json={"changes":[{
        "resource":"transaction", "id":transaction_id, "op":"upsert",
        "updated_at":"2026-10-24T00:00:00Z", "data":{
            "amount":original_txn["amount_paise"], "categoryId":original_txn["category_id"],
            "date":original_txn["transaction_date"], "createdAt":original_txn["created_at"],
            "place":"Test receipt", "note":"", "paymentMode":"cash", "time":"12:00",
            "provenance":"user", "billPhotoUri":f"attachment:{attachment_id}",
        },
    }]})
    assert linked.status_code == 200, linked.text
    assert linked.json()["results"][0]["status"] == "applied", linked.json()
    pulled = client.get("/api/v1/sync/pull?cursor=0&limit=500", headers=a_headers)
    txn_change = next(item for item in pulled.json()["changes"] if item["resource"] == "transaction")
    assert txn_change["data"]["billPhotoUri"] == f"attachment:{attachment_id}"
    # A second device on the same account can resolve the synced pointer securely.
    assert client.get(f"/api/v1/attachments/{attachment_id}", headers=a_headers).content == result.content
    assert client.get(f"/api/v1/attachments/{attachment_id}", headers=b_headers).status_code == 404


def test_attachment_rejects_bad_image_and_oversize(client, tmp_path, monkeypatch):
    monkeypatch.setattr(attachment_api, "ATTACHMENT_DIR", str(tmp_path))
    headers = auth_headers(register(client, "bad-photo@example.com"))
    txn_id, attachment_id = _transaction(client, headers), str(uuid.uuid4())
    invalid = b"not an image"
    assert _upload(client, headers, txn_id, attachment_id, invalid).status_code == 422
    too_large = b"x" * (5 * 1024 * 1024 + 1)
    result = _upload(client, headers, txn_id, str(uuid.uuid4()), too_large)
    assert result.status_code == 413


def test_attachment_quota_is_per_user(client, tmp_path, monkeypatch):
    monkeypatch.setattr(attachment_api, "ATTACHMENT_DIR", str(tmp_path))
    monkeypatch.setattr(attachment_api, "ATTACHMENT_QUOTA_BYTES", 1)
    headers = auth_headers(register(client, "quota@example.com"))
    txn_id, attachment_id = _transaction(client, headers), str(uuid.uuid4())
    result = _upload(client, headers, txn_id, attachment_id, _jpeg())
    assert result.status_code == 413
    assert result.json()["error"]["code"] == "storage_quota_exceeded"
