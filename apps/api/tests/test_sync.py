import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from tests.helpers import auth_headers, register


def _category(client, headers):
    return client.get("/api/v1/categories", headers=headers).json()["items"][0]


def _push(client, headers, changes):
    return client.post("/api/v1/sync/push", headers=headers, json={"changes": changes})


def _new_category(name="Cafe"):
    now = datetime.now(UTC)
    return {"resource":"category", "id":str(uuid.uuid4()), "op":"upsert",
            "updated_at":now.isoformat(), "data":{"name":name, "color":"#123456", "icon":"cup-soda",
             "type":"variable", "is_archived":False, "sort_order":20,
             "created_at":now.isoformat()}}


def test_v2_sync_retry_is_idempotent_and_newer_version_wins(client):
    tokens = register(client)
    headers = auth_headers(tokens)
    change = _new_category()
    first = _push(client, headers, [change]).json()["results"][0]
    assert first["status"] == "applied"
    retried = _push(client, headers, [change]).json()["results"][0]
    assert retried["status"] == "unchanged"
    newer = {**change, "updated_at":(datetime.fromisoformat(change["updated_at"]) + timedelta(seconds=3)).isoformat(),
             "data":{**change["data"],"name":"Cafe Updated"}}
    assert _push(client, headers, [newer]).json()["results"][0]["status"] == "applied"
    pulled = client.get("/api/v1/sync/pull?cursor=0&limit=100", headers=headers).json()
    assert any(c["id"] == change["id"] and c["data"].get("name") == "Cafe Updated" for c in pulled["changes"])


def test_sync_tombstone_propagates_and_pagination_uses_cursor(client):
    tokens = register(client)
    headers = auth_headers(tokens)
    category = _category(client, headers)
    deleted_at = (datetime.now(UTC) + timedelta(seconds=2)).isoformat()
    result = _push(client, headers, [{"resource":"category","id":category["id"],"op":"delete",
                                      "updated_at":deleted_at,"data":{}}]).json()["results"][0]
    assert result["status"] == "applied"
    first = client.get("/api/v1/sync/pull?cursor=0&limit=2", headers=headers).json()
    assert first["has_more"] is True
    second = client.get(f"/api/v1/sync/pull?cursor={first['next_cursor']}&limit=2", headers=headers).json()
    assert second["next_cursor"] > first["next_cursor"]
    all_changes = client.get("/api/v1/sync/pull?cursor=0&limit=100", headers=headers).json()["changes"]
    tombstone = next(c for c in all_changes if c["data"].get("name") == category["name"] and c["op"] == "delete")
    assert tombstone["deleted_at"]


def test_sync_group_is_atomic_on_missing_reference(client):
    tokens = register(client)
    headers = auth_headers(tokens)
    now = datetime.now(UTC)
    category = _new_category("Group category")
    transaction_id = str(uuid.uuid4())
    txn = {"resource":"transaction","id":transaction_id,"op":"upsert","updated_at":now.isoformat(),
           "group_id":"atomic-1","data":{"created_at":now.isoformat(),"category_id":str(uuid.uuid4()),
           "kind":"expense","amount_paise":900,"transaction_date":"2026-10-22","local_date":"2026-10-22",
           "place":"Cafe","note":"","payment_mode":"upi","local_time":"12:00:00","timezone":"Asia/Kolkata","provenance":"user"}}
    category["group_id"] = "atomic-1"
    result = _push(client, headers, [category, txn]).json()["results"]
    assert [r["status"] for r in result] == ["rejected", "rejected"]
    assert not any(c["name"] == "Group category" for c in client.get("/api/v1/categories", headers=headers).json()["items"])
    assert not any(c["id"] == transaction_id for c in client.get("/api/v1/sync/pull?cursor=0&limit=100", headers=headers).json()["changes"])


def test_sync_group_applies_category_before_transaction(client):
    tokens = register(client)
    headers = auth_headers(tokens)
    now = datetime.now(UTC)
    category = _new_category("Synced Cafe")
    txn_id = str(uuid.uuid4())
    txn = {"resource":"transaction","id":txn_id,"op":"upsert","updated_at":now.isoformat(),
           "group_id":"valid-1","data":{"created_at":now.isoformat(),"category_id":category["id"],
           "kind":"expense","amount_paise":900,"transaction_date":"2026-10-22","local_date":"2026-10-22",
           "place":"Cafe","note":"","payment_mode":"upi","local_time":"12:00:00","timezone":"Asia/Kolkata","provenance":"user"}}
    category["group_id"] = "valid-1"
    result = _push(client, headers, [txn, category]).json()["results"]
    assert [r["status"] for r in result] == ["applied", "applied"]


def test_sync_is_scoped_by_authenticated_user(client):
    owner = register(client, "owner@example.com")
    stranger = register(client, "stranger@example.com")
    owner_headers, stranger_headers = auth_headers(owner), auth_headers(stranger)
    change = _new_category("Private")
    assert _push(client, owner_headers, [change]).json()["results"][0]["status"] == "applied"
    foreign = client.get("/api/v1/sync/pull?cursor=0&limit=100", headers=stranger_headers).json()["changes"]
    assert not any(item["id"] == change["id"] for item in foreign)
    # A tombstone under another user does not alter the owner's resource.
    _push(client, stranger_headers, [{"resource":"category","id":change["id"],"op":"delete",
                                      "updated_at":(datetime.now(UTC)+timedelta(seconds=1)).isoformat(),"data":{}}])
    visible = client.get("/api/v1/categories", headers=owner_headers).json()["items"]
    assert any(item["id"] == change["id"] for item in visible)


def test_all_synced_resources_are_tenant_scoped(client):
    owner, stranger = register(client, "all-owner@example.com"), register(client, "all-stranger@example.com")
    a_headers, b_headers = auth_headers(owner), auth_headers(stranger)
    cats = [_new_category("A"), _new_category("B")]
    period_id, person_id, bill_id, txn_id = [str(uuid.uuid4()) for _ in range(4)]
    now = datetime.now(UTC).isoformat()
    settings_id = client.get("/api/v1/sync/pull?cursor=0&limit=100", headers=a_headers).json()["changes"][-1]["id"]
    changes = [
        *cats,
        {"resource":"budget_period","id":period_id,"op":"upsert","updated_at":now,"group_id":"all","data":{"created_at":now,"month":"2026-10","start_day":1,"start_date":"2026-10-01","end_date":"2026-10-31","total_paise":10000,"status":"open"}},
        {"resource":"person","id":person_id,"op":"upsert","updated_at":now,"group_id":"all","data":{"created_at":now,"name":"Riya","upi_id":None,"is_archived":False}},
        {"resource":"group_bill","id":bill_id,"op":"upsert","updated_at":now,"group_id":"all","data":{"created_at":now,"title":"Dinner","bill_date":"2026-10-22","person_ids":["me",person_id],"payments":{"me":1000,person_id:0},"method":"equal","tax_paise":0,"tip_paise":0,"category_id":cats[0]["id"],"is_settled":False}},
        {"resource":"budget_allocation","id":str(uuid.uuid4()),"op":"upsert","updated_at":now,"group_id":"all","data":{"created_at":now,"period_id":period_id,"category_id":cats[0]["id"],"amount_paise":1000,"rollover":False}},
        {"resource":"budget_transfer","id":str(uuid.uuid4()),"op":"upsert","updated_at":now,"group_id":"all","data":{"created_at":now,"period_id":period_id,"from_category_id":cats[0]["id"],"to_category_id":cats[1]["id"],"amount_paise":100,"note":"move"}},
        {"resource":"transaction","id":txn_id,"op":"upsert","updated_at":now,"group_id":"all","data":{"created_at":now,"category_id":cats[0]["id"],"kind":"expense","amount_paise":500,"transaction_date":"2026-10-22","local_date":"2026-10-22","place":"Cafe","note":"","payment_mode":"cash","local_time":"10:00:00","timezone":"Asia/Kolkata","provenance":"user","group_bill_id":bill_id}},
        {"resource":"settlement","id":str(uuid.uuid4()),"op":"upsert","updated_at":now,"group_id":"all","data":{"created_at":now,"group_bill_id":bill_id,"from_person_id":person_id,"to_person_id":"me","amount_paise":500,"paid_amount_paise":0,"is_paid":False}},
        {"resource":"attachment","id":str(uuid.uuid4()),"op":"upsert","updated_at":now,"group_id":"all","data":{"created_at":now,"transaction_id":txn_id,"mime_type":"image/jpeg","size_bytes":0,"checksum_sha256":"0"*64,"upload_status":"pending"}},
        {"resource":"user_settings","id":settings_id,"op":"upsert","updated_at":now,"group_id":"all","data":{"budget_start_day":1,"ai_enabled":True,"entry_parsing_enabled":True,"categorization_enabled":True,"split_drafting_enabled":True,"budget_suggestions_enabled":True,"summaries_enabled":True}},
        {"resource":"place_rule","id":str(uuid.uuid4()),"op":"upsert","updated_at":now,"group_id":"all","data":{"created_at":now,"place_pattern":"cafe","category_id":cats[0]["id"]}},
    ]
    applied = _push(client, a_headers, changes).json()["results"]
    assert all(result["status"] == "applied" for result in applied), applied
    # User B sends deletes for A's IDs. Those writes only create B-owned tombstones.
    deletes = [{"resource":c["resource"],"id":c["id"],"op":"delete","updated_at":(datetime.now(UTC)+timedelta(seconds=2)).isoformat(),"data":{}} for c in changes]
    assert all(r["status"] == "applied" for r in _push(client, b_headers, deletes).json()["results"])
    owner_pull = client.get("/api/v1/sync/pull?cursor=0&limit=200", headers=a_headers).json()["changes"]
    for change in changes:
        assert any(item["resource"] == change["resource"] and item["id"] == change["id"] and item["op"] == "upsert" for item in owner_pull)


def test_mobile_engine_golden_fixtures_validate_group_bill_and_period_invariants(client, db_session):
    golden = json.loads((Path(__file__).parent / "fixtures/mobile-golden.json").read_text())
    headers = auth_headers(register(client, "golden@example.com"))
    now = datetime.now(UTC).isoformat()
    party = golden["party_example"]
    group_id = "golden-party"
    people = [{"resource":"person","id":person_id,"op":"upsert","updated_at":now,"group_id":group_id,
               "data":{"createdAt":now,"name":f"Person {person_id}","isMe":False,"isArchived":False}}
              for person_id in party["person_ids"]]
    bill = {"resource":"group_bill","id":str(uuid.uuid4()),"op":"upsert","updated_at":now,"group_id":group_id,
            "data":{"createdAt":now,"title":"Golden party","date":"2025-10-01",
                    "personIds":party["person_ids"],"payments":party["payments"],"method":"equal",
                    "total_paise":party["total_paise"],"shares":[{"person_id":p,"amount_paise":v} for p,v in party["equal_shares"].items()],"isSettled":False}}
    results = _push(client, headers, [bill,*people]).json()["results"]
    assert all(result["status"] == "applied" for result in results), results
    for period in golden["month_boundaries"]:
        change = {"resource":"budget_period","id":str(uuid.uuid4()),"op":"upsert","updated_at":now,
                  "data":{**period,"totalPaise":100000,"createdAt":now}}
        pushed = _push(client, headers, [change]).json()["results"][0]
        assert pushed["status"] == "applied", pushed
        from expense_tracker_api.models import BudgetPeriod
        row = db_session.query(BudgetPeriod).filter_by(id=uuid.UUID(change["id"])).one()
        assert row.start_date.isoformat() == period["start_date"]
        assert row.end_date.isoformat() == period["end_date"]


def test_mobile_default_category_ids_map_to_server_owned_default_rows(client):
    tokens = register(client, "mobile-defaults@example.com")
    headers = auth_headers(tokens)
    category = {"resource":"category","id":"cat-0","op":"upsert",
                "updated_at":(datetime.now(UTC)+timedelta(seconds=1)).isoformat(),
                "data":{"id":"cat-0","name":"Food","type":"variable","icon":"utensils",
                        "color":"#E67E22","isArchived":False,"sortOrder":0}}
    result = _push(client, headers, [category]).json()["results"][0]
    assert result["status"] == "applied"
    pull = client.get("/api/v1/sync/pull?cursor=0&limit=100", headers=headers).json()["changes"]
    assert any(c["resource"] == "category" and c["id"] == "cat-0" and c["data"]["name"] == "Food" for c in pull)


def test_paginated_registration_sync_keeps_mobile_category_aliases(client):
    tokens = register(client, "paged-defaults@example.com")
    headers = auth_headers(tokens)
    first = client.get("/api/v1/sync/pull?cursor=0&limit=1", headers=headers).json()
    next_page = client.get(f"/api/v1/sync/pull?cursor={first['next_cursor']}&limit=50", headers=headers).json()
    category_ids = [change["data"]["id"] for change in next_page["changes"] if change["resource"] == "category"]
    assert category_ids == [f"cat-{index}" for index in range(1, 9)]


def test_future_timestamp_is_clamped_to_server_time(client):
    tokens = register(client, "future-clock@example.com")
    headers = auth_headers(tokens)
    change = _new_category("Future clock")
    now = datetime.now(UTC)
    change["updated_at"] = (now + timedelta(hours=1)).isoformat()
    change["data"]["created_at"] = now.isoformat()
    assert _push(client, headers, [change]).json()["results"][0]["status"] == "applied"
    row = next(c for c in client.get("/api/v1/sync/pull?cursor=0&limit=100", headers=headers).json()["changes"]
               if c["id"] == change["id"])
    assert datetime.fromisoformat(row["updated_at"]) <= datetime.now(UTC) + timedelta(minutes=5)


def test_sync_rejects_invalid_clock_time_and_empty_group_bill_total(client):
    tokens = register(client, "invariants@example.com")
    headers = auth_headers(tokens)
    categories = client.get("/api/v1/categories", headers=headers).json()["items"]
    now = datetime.now(UTC).isoformat()
    transaction_id = str(uuid.uuid4())
    bad_transaction = {"resource":"transaction", "id":transaction_id, "op":"upsert", "updated_at":now,
                       "data":{"id":transaction_id,"createdAt":now,"amount":100,"categoryId":categories[0]["id"],
                               "date":"2026-10-23","time":"99:99","paymentMode":"cash"}}
    rejected = _push(client, headers, [bad_transaction]).json()["results"][0]
    assert rejected["status"] == "rejected"
    assert rejected["reason_code"] == "validation_error"
    bill_id = str(uuid.uuid4())
    bad_bill = {"resource":"group_bill", "id":bill_id, "op":"upsert", "updated_at":now,
                "data":{"id":bill_id,"title":"Empty","date":"2026-10-23","personIds":["me"],
                        "payments":{"me":0},"method":"equal","isSettled":False,"createdAt":now}}
    rejected_bill = _push(client, headers, [bad_bill]).json()["results"][0]
    assert rejected_bill["status"] == "rejected"
    assert rejected_bill["reason_code"] == "invariant_violation"


def test_stale_member_rejects_entire_atomic_group(client):
    tokens = register(client, "stale-group@example.com")
    headers = auth_headers(tokens)
    original = _new_category("Existing")
    _push(client, headers, [original])
    newer = {**original, "updated_at":(datetime.fromisoformat(original["updated_at"]) + timedelta(seconds=5)).isoformat(),
             "data":{**original["data"],"name":"Existing newer"}}
    _push(client, headers, [newer])
    stale = {**original,"group_id":"stale-group"}
    other = _new_category("Must rollback")
    other["group_id"] = "stale-group"
    results = _push(client, headers, [stale,other]).json()["results"]
    assert all(result["status"] == "rejected" and result["reason_code"] == "stale" for result in results)
    assert not any(item["name"] == "Must rollback" for item in client.get("/api/v1/categories", headers=headers).json()["items"])


def test_expired_cursor_returns_cursor_too_old_but_zero_bootstraps(client, db_session):
    from datetime import timedelta as td

    from expense_tracker_api.models import SyncChange
    tokens = register(client, "old-cursor@example.com")
    headers = auth_headers(tokens)
    db_session.query(SyncChange).update({SyncChange.created_at:datetime.now(UTC)-td(days=100)})
    db_session.commit()
    stale = client.get("/api/v1/sync/pull?cursor=5", headers=headers)
    assert stale.status_code == 410
    assert stale.json()["error"]["code"] == "cursor_too_old"
    assert client.get("/api/v1/sync/pull?cursor=0", headers=headers).status_code == 200


def test_tombstone_rows_are_pruned_after_retention(client, db_session):
    from expense_tracker_api.models import Category

    tokens = register(client, "purge-tombstone@example.com")
    headers = auth_headers(tokens)
    change = _new_category("Expired tombstone")
    assert _push(client, headers, [change]).json()["results"][0]["status"] == "applied"
    delete_change = {**change, "op":"delete", "updated_at":(datetime.now(UTC)+timedelta(seconds=1)).isoformat(), "data":{}}
    assert _push(client, headers, [delete_change]).json()["results"][0]["status"] == "applied"
    row = db_session.query(Category).filter_by(id=uuid.UUID(change["id"])).one()
    row.deleted_at = datetime.now(UTC) - timedelta(days=91)
    db_session.commit()
    full = client.get("/api/v1/sync/pull?cursor=0&limit=100", headers=headers)
    assert full.status_code == 200
    assert db_session.query(Category).filter_by(id=uuid.UUID(change["id"])).one_or_none() is None
