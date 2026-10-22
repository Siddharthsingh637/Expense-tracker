import os

import pytest

from expense_tracker_api.ai.providers import ProviderResult
from expense_tracker_api.api.v1 import ai as ai_api
from expense_tracker_api.models import AIUsage, UserSettings
from tests.helpers import auth_headers, register


def _headers(client):
    return auth_headers(register(client))


def test_mock_parse_entry_and_category_drafts(client):
    headers = _headers(client)
    categories = client.get("/api/v1/categories", headers=headers).json()["items"]
    parsed = client.post("/api/v1/ai/parse-entry", headers=headers, json={
        "text":"₹30 chai via upi", "context":{"now":"2026-10-22T10:00:00Z","timezone":"Asia/Kolkata"}
    })
    assert parsed.status_code == 200
    assert parsed.json()["type"] == "transaction"
    assert parsed.json()["payload"]["amount_paise"] == 3000
    assert parsed.json()["payload"]["payment_mode"] == "upi"
    suggestion = client.post("/api/v1/ai/suggest-category", headers=headers,
                             json={"place":"chai stall", "categories":[{"id":c["id"],"name":c["name"]} for c in categories]})
    assert suggestion.status_code == 200
    assert suggestion.json()["type"] == "category"
    assert suggestion.json()["payload"]["category_id"] == next(c["id"] for c in categories if c["name"] == "Food")


def test_mock_budget_is_within_total_and_split_flags_unmatched_names(client):
    headers = _headers(client)
    categories = client.get("/api/v1/categories", headers=headers).json()["items"]
    budget = client.post("/api/v1/ai/propose-budget", headers=headers, json={
        "total_paise":10001,"start_day":1,"history":[],
        "categories":[{"id":c["id"],"name":c["name"]} for c in categories]
    })
    assert budget.status_code == 200
    assert sum(a["amount_paise"] for a in budget.json()["payload"]["allocations"]) <= 10001
    split = client.post("/api/v1/ai/draft-split", headers=headers, json={
        "text":"Paid 100 at dinner with Riya and Amit, split equally",
        "people":[{"id":"p1","name":"Riya"}],"categories":[]
    })
    assert split.status_code == 200
    assert split.json()["payload"]["unmatched_names"] == ["Amit"]


def test_ask_returns_only_query_and_narrative_checks_report_numbers(client):
    headers = _headers(client)
    answer = client.post("/api/v1/ai/ask", headers=headers, json={
        "question":"How much did I spend this month?","categories":[],"periods":[]
    })
    assert answer.status_code == 200
    assert answer.json()["type"] == "query"
    assert "amount" not in answer.json()["payload"]
    report = {"month":"2026-10","totalSpentPaise":12345,"totalAllocatedPaise":15000,
              "totalBudgetPaise":15000,"savedOrOverspentPaise":2655,"cashPaidOutPaise":5000,
              "categoryBreakdown":[],"biggestChanges":[],"duplicateSuspects":[]}
    narrative = client.post("/api/v1/ai/month-narrative", headers=headers,
                            json={"report":report,"categories":[]})
    assert narrative.status_code == 200
    assert "₹123.45" in narrative.json()["payload"]["text"]
    assert len(narrative.json()["payload"]["text"].split(". ")) >= 2
    assert len(narrative.json()["payload"]["suggestions"]) <= 3


def test_ai_toggle_off_returns_ai_unavailable(client, db_session):
    headers = _headers(client)
    settings = db_session.query(UserSettings).one()
    settings.ai_enabled = False
    db_session.commit()
    response = client.post("/api/v1/ai/parse-entry", headers=headers, json={"text":"chai 30"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_unavailable"


def test_ai_rate_and_daily_limits_are_enforced(client, monkeypatch):
    headers = _headers(client)
    monkeypatch.setattr(ai_api, "AI_REQUESTS_PER_MINUTE", 1)
    client.post("/api/v1/ai/parse-entry", headers=headers, json={"text":"tea 20"})
    limited = client.post("/api/v1/ai/parse-entry", headers=headers, json={"text":"tea 20"})
    assert limited.status_code == 429
    assert limited.headers["Retry-After"]


def test_ai_daily_cap_is_enforced(client, monkeypatch):
    headers = _headers(client)
    monkeypatch.setattr(ai_api, "AI_REQUESTS_PER_MINUTE", 10)
    monkeypatch.setattr(ai_api, "AI_REQUESTS_PER_DAY", 1)
    assert client.post("/api/v1/ai/parse-entry", headers=headers, json={"text":"tea 20"}).status_code == 200
    limited = client.post("/api/v1/ai/parse-entry", headers=headers, json={"text":"tea 20"})
    assert limited.status_code == 429
    assert limited.headers["Retry-After"]


def test_provider_not_configured_maps_to_ai_unavailable(client, monkeypatch):
    headers = _headers(client)
    def unavailable():
        raise RuntimeError("no provider credentials")
    monkeypatch.setattr(ai_api, "get_provider", unavailable)
    response = client.post("/api/v1/ai/parse-entry", headers=headers, json={"text":"tea 20"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_unavailable"


def test_ai_usage_contains_metadata_only(client, db_session):
    headers = _headers(client)
    client.post("/api/v1/ai/parse-entry", headers=headers, json={"text":"private merchant 20"})
    usage = db_session.query(AIUsage).one()
    assert usage.endpoint == "parse-entry"
    assert not hasattr(usage, "prompt")
    assert not hasattr(usage, "image")


def test_invalid_provider_schema_retries_once_then_returns_valid_draft(client, monkeypatch):
    headers = _headers(client)
    calls = []

    class Provider:
        def generate(self, endpoint, data, model):
            calls.append(data.get("_repair_output"))
            payload = {"amount_paise": "bad"} if len(calls) == 1 else {
                "amount_paise": 2500, "place": "Cafe", "note": "", "payment_mode": "upi",
                "local_date": "2026-10-23", "local_time": "12:00:00", "kind": "expense",
                "category_id": None,
            }
            return ProviderResult(payload, .8, "test", "mock", model)

    monkeypatch.setattr(ai_api, "get_provider", lambda: Provider())
    response = client.post("/api/v1/ai/parse-entry", headers=headers, json={"text":"Cafe 25"})
    assert response.status_code == 200
    assert calls == [False, True]
    assert response.json()["payload"]["amount_paise"] == 2500


def test_budget_overflow_is_corrected_deterministically(client, monkeypatch):
    headers = _headers(client)

    class Provider:
        def generate(self, endpoint, data, model):
            return ProviderResult({"allocations":[
                {"category_id":"food", "amount_paise":80, "reason":"food"},
                {"category_id":"rent", "amount_paise":70, "reason":"rent"},
            ]}, .8, "test", "mock", model)

    monkeypatch.setattr(ai_api, "get_provider", lambda: Provider())
    response = client.post("/api/v1/ai/propose-budget", headers=headers, json={
        "total_paise":100, "start_day":1, "history":[], "categories":[]
    })
    amounts = [item["amount_paise"] for item in response.json()["payload"]["allocations"]]
    assert response.status_code == 200
    assert amounts == [53, 47]
    assert sum(amounts) == 100


def test_disabled_feature_toggle_blocks_only_its_ai_feature(client, db_session):
    headers = _headers(client)
    settings = db_session.query(UserSettings).one()
    settings.entry_parsing_enabled = False
    db_session.commit()
    assert client.post("/api/v1/ai/parse-entry", headers=headers, json={"text":"tea 20"}).status_code == 503
    assert client.post("/api/v1/ai/suggest-category", headers=headers,
                       json={"place":"tea", "categories":[]}).status_code == 200


def test_narrative_with_unprovided_number_uses_safe_template(client, monkeypatch):
    headers = _headers(client)

    class Provider:
        def generate(self, endpoint, data, model):
            return ProviderResult({"text":"You spent ₹12.34. That is 99% more. Review the categories.",
                                   "suggestions":["Review"]}, .9, "test", "mock", model)

    monkeypatch.setattr(ai_api, "get_provider", lambda: Provider())
    response = client.post("/api/v1/ai/month-narrative", headers=headers, json={
        "report":{"month":"2026-10", "totalSpentPaise":1234}, "categories":[]
    })
    text = response.json()["payload"]["text"]
    assert "99" not in text
    assert len(text.split(". ")) == 3


@pytest.mark.live
@pytest.mark.skipif(not os.getenv("ANTHROPIC_API_KEY"), reason="ANTHROPIC_API_KEY is not configured")
def test_live_anthropic_parse_entry(client):
    tokens = register(client, "live-ai@example.com")
    response = client.post("/api/v1/ai/parse-entry", headers=auth_headers(tokens), json={
        "text":"paid ₹42 for tea", "context":{"timezone":"Asia/Kolkata"}
    })
    assert response.status_code == 200
    assert response.json()["payload"]["amount_paise"] == 4200
