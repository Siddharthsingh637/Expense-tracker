def test_health_endpoint(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-request-id"]


def test_mobile_web_origins_can_preflight_authenticated_receipt_upload(client):
    response = client.options("/api/v1/attachments/00000000-0000-4000-8000-000000000001", headers={
        "Origin":"http://localhost:8081", "Access-Control-Request-Method":"PUT",
        "Access-Control-Request-Headers":"authorization,content-type,x-checksum-sha256,x-transaction-id",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert "x-transaction-id" in response.headers["access-control-allow-headers"].lower()
