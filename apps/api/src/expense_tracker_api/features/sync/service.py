from __future__ import annotations

import re
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from expense_tracker_api.core.config import (
    MAX_SYNC_PULL_LIMIT,
    SYNC_TOMBSTONE_DAYS,
)
from expense_tracker_api.models import (
    Attachment,
    Budget,
    BudgetAllocation,
    BudgetPeriod,
    BudgetTransfer,
    Category,
    GroupBill,
    Person,
    PlaceRule,
    Settlement,
    SyncChange,
    Transaction,
    User,
    UserSettings,
    UserSyncState,
    utcnow,
)
from expense_tracker_api.shared.common import aware, serialize, wire_value
from expense_tracker_api.shared.exceptions import error

RESOURCE_MODELS = {
    "category": Category,
    "transaction": Transaction,
    "budget_period": BudgetPeriod,
    "budget_allocation": BudgetAllocation,
    "budget_transfer": BudgetTransfer,
    "person": Person,
    "group_bill": GroupBill,
    "settlement": Settlement,
    "attachment": Attachment,
    "user_settings": UserSettings,
    "place_rule": PlaceRule,
}

ORDER = {
    name: i
    for i, name in enumerate((
        "category",
        "budget_period",
        "person",
        "group_bill",
        "budget_allocation",
        "budget_transfer",
        "settlement",
        "transaction",
        "attachment",
        "user_settings",
        "place_rule",
    ))
}

INSERT_ONLY = {"budget_transfer", "settlement"}

MOBILE_KEYS = {
    "category": {"isArchived": "is_archived", "sortOrder": "sort_order"},
    "transaction": {
        "categoryId": "category_id",
        "paymentMode": "payment_mode",
        "billPhotoUri": "attachment_id",
        "date": "local_date",
        "time": "local_time",
        "createdAt": "created_at",
        "splitId": "group_bill_id",
    },
    "budget_period": {
        "totalPaise": "total_paise",
        "startDay": "start_day",
        "startDate": "start_date",
        "endDate": "end_date",
        "closedAt": "closed_at",
    },
    "budget_allocation": {
        "categoryId": "category_id",
        "allocatedPaise": "amount_paise",
        "periodId": "period_id",
    },
    "budget_transfer": {
        "periodId": "period_id",
        "fromCategoryId": "from_category_id",
        "toCategoryId": "to_category_id",
        "amountPaise": "amount_paise",
        "voidedAt": "voided_at",
    },
    "person": {"upiId": "upi_id", "isArchived": "is_archived", "isMe": "is_me"},
    "group_bill": {
        "personIds": "person_ids",
        "customShares": "custom_shares",
        "percentShares": "percent_shares",
        "shareWeights": "share_weights",
        "taxPaise": "tax_paise",
        "tipPaise": "tip_paise",
        "categoryId": "category_id",
        "isSettled": "is_settled",
        "createdAt": "created_at",
        "billDate": "bill_date",
        "date": "bill_date",
    },
    "settlement": {
        "groupBillId": "group_bill_id",
        "fromPersonId": "from_person_id",
        "toPersonId": "to_person_id",
        "amountPaise": "amount_paise",
        "paidAmountPaise": "paid_amount_paise",
        "isPaid": "is_paid",
        "paidAt": "paid_at",
        "voidedAt": "voided_at",
    },
    "attachment": {
        "transactionId": "transaction_id",
        "sizeBytes": "size_bytes",
        "checksumSha256": "checksum_sha256",
        "uploadStatus": "upload_status",
    },
    "user_settings": {"budgetStartDay": "budget_start_day", "aiEnabled": "ai_enabled"},
    "place_rule": {"placePattern": "place_pattern", "categoryId": "category_id"},
}


class AtomicGroupConflict(ValueError):
    pass


def next_sync_seq(db: Session, user_id: uuid.UUID) -> int:
    state = db.scalar(
        select(UserSyncState).where(UserSyncState.user_id == user_id).with_for_update()
    )
    if state is None:
        state = UserSyncState(user_id=user_id, last_sync_seq=0)
        db.add(state)
        db.flush()
    state.last_sync_seq += 1
    db.flush()
    return state.last_sync_seq


def _purge_tombstones(db: Session, user_id: uuid.UUID, cutoff: datetime) -> list[str]:
    """Remove expired deleted rows in leaf-first order; preserve referenced parents."""
    purge_order = (
        Settlement,
        Attachment,
        Transaction,
        BudgetTransfer,
        BudgetAllocation,
        PlaceRule,
        Budget,
        GroupBill,
        Person,
        BudgetPeriod,
        Category,
    )
    storage_keys: list[str] = []
    for model in purge_order:
        rows = list(
            db.scalars(
                select(model)
                .where(
                    model.user_id == user_id,
                    model.deleted_at.is_not(None),
                    model.deleted_at < cutoff,
                )
                .limit(200)
            )
        )
        for row in rows:
            storage_key = row.storage_key if isinstance(row, Attachment) else None
            try:
                with db.begin_nested():
                    db.delete(row)
                    db.flush()
                if storage_key:
                    storage_keys.append(storage_key)
            except IntegrityError:
                continue
    return storage_keys


def _reason(exc: Exception) -> str:
    message = str(exc).lower()
    if "stale" in message:
        return "stale"
    if "missing_reference" in message:
        return "missing_reference"
    if isinstance(exc, IntegrityError):
        if "unique" in message or "duplicate" in message or "already exists" in message:
            return "conflict"
        return "missing_reference"
    if "invariant_violation" in message:
        return "invariant_violation"
    return "validation_error"


def parse_value(column, value):
    if value is None:
        return None
    pytype = column.type.python_type
    if pytype is uuid.UUID and not isinstance(value, uuid.UUID):
        return uuid.UUID(str(value))
    if pytype is date and isinstance(value, str):
        return date.fromisoformat(value)
    if pytype is datetime and isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    if pytype is int and (isinstance(value, bool) or not isinstance(value, int)):
        raise ValueError(f"{column.name} must be an integer")
    if pytype is bool and not isinstance(value, bool):
        raise ValueError(f"{column.name} must be a boolean")
    return value


def _mobile_data(db, resource: str, row) -> dict[str, Any]:
    values = serialize(row)
    if resource == "category":
        from expense_tracker_api.shared.common import DEFAULT_CATEGORIES

        default_id = (
            f"cat-{row.sort_order}"
            if 0 <= row.sort_order < len(DEFAULT_CATEGORIES)
            and row.name == DEFAULT_CATEGORIES[row.sort_order][0]
            else values["id"]
        )
        data = {
            "id": default_id,
            "name": values["name"],
            "type": values["type"],
            "icon": values["icon"],
            "color": values["color"],
            "isArchived": values["is_archived"],
            "sortOrder": values["sort_order"],
            "createdAt": values["created_at"],
        }
    elif resource == "transaction":
        amount = values["amount_paise"] * (1 if values["kind"] == "expense" else -1)
        local_date = values.get("local_date") or values["transaction_date"]
        category = db.scalar(
            select(Category).where(Category.id == row.category_id, Category.user_id == row.user_id)
        )
        from expense_tracker_api.shared.common import DEFAULT_CATEGORIES

        category_id = (
            f"cat-{category.sort_order}"
            if category
            and 0 <= category.sort_order < len(DEFAULT_CATEGORIES)
            and category.name == DEFAULT_CATEGORIES[category.sort_order][0]
            else values["category_id"]
        )
        data = {
            "id": values["id"],
            "amount": amount,
            "categoryId": category_id,
            "place": values.get("place") or values.get("merchant") or "",
            "note": values.get("note") or "",
            "paymentMode": values["payment_mode"],
            "date": local_date,
            "time": str(values.get("local_time") or "00:00")[:5],
            "createdAt": values["created_at"],
            "provenance": values["provenance"],
            "splitId": values.get("group_bill_id"),
            "billPhotoUri": f"attachment:{values['attachment_id']}"
            if values.get("attachment_id")
            else None,
        }
    elif resource == "budget_period":
        data = {
            "id": values["id"],
            "month": values["month"],
            "totalPaise": values["total_paise"],
            "startDay": values["start_day"],
        }
    elif resource == "budget_allocation":
        period = db.scalar(
            select(BudgetPeriod).where(
                BudgetPeriod.user_id == row.user_id, BudgetPeriod.id == row.period_id
            )
        )
        category = db.scalar(
            select(Category).where(Category.id == row.category_id, Category.user_id == row.user_id)
        )
        from expense_tracker_api.shared.common import DEFAULT_CATEGORIES

        category_id = (
            f"cat-{category.sort_order}"
            if category
            and 0 <= category.sort_order < len(DEFAULT_CATEGORIES)
            and category.name == DEFAULT_CATEGORIES[category.sort_order][0]
            else values["category_id"]
        )
        data = {
            "id": values["id"],
            "month": period.month if period else "",
            "categoryId": category_id,
            "allocatedPaise": values["amount_paise"],
            "rollover": values["rollover"],
        }
    elif resource == "person":
        data = {
            "id": values["id"],
            "name": values["name"],
            "upiId": values["upi_id"],
            "isMe": False,
            "isArchived": values["is_archived"],
        }
    elif resource == "group_bill":
        values.setdefault("tax_paise", 0)
        values.setdefault("tip_paise", 0)
        category = (
            db.scalar(
                select(Category).where(Category.id == row.category_id, Category.user_id == row.user_id)
            )
            if row.category_id
            else None
        )
        from expense_tracker_api.shared.common import DEFAULT_CATEGORIES

        category_id = (
            f"cat-{category.sort_order}"
            if category
            and 0 <= category.sort_order < len(DEFAULT_CATEGORIES)
            and category.name == DEFAULT_CATEGORIES[category.sort_order][0]
            else values["category_id"]
        )
        data = {
            "id": values["id"],
            "title": values["title"],
            "date": values["bill_date"],
            "personIds": values["person_ids"],
            "payments": values["payments"],
            "method": values["method"],
            "customShares": values["custom_shares"],
            "percentShares": values["percent_shares"],
            "shareWeights": values["share_weights"],
            "items": values["items"],
            "taxPaise": values["tax_paise"],
            "tipPaise": values["tip_paise"],
            "categoryId": category_id,
            "isSettled": values["is_settled"],
            "createdAt": values["created_at"],
        }
    elif resource == "settlement":
        data = {
            "id": values["id"],
            "groupBillId": values["group_bill_id"],
            "fromPersonId": values["from_person_id"],
            "toPersonId": values["to_person_id"],
            "amountPaise": values["amount_paise"],
            "paidAmountPaise": values["paid_amount_paise"],
            "isPaid": values["is_paid"],
            "paidAt": values["paid_at"],
        }
    elif resource == "user_settings":
        data = {
            "budgetStartDay": values["budget_start_day"],
            "aiEnabled": values["ai_enabled"],
            "aiFeatureToggles": {
                "entryParsing": values["entry_parsing_enabled"],
                "categorization": values["categorization_enabled"],
                "splitDrafting": values["split_drafting_enabled"],
                "budgetSuggestions": values["budget_suggestions_enabled"],
                "summaries": values["summaries_enabled"],
            },
        }
    else:
        data = {k: v for k, v in values.items() if k not in {"user_id", "sync_seq", "storage_key"}}
    return {k: v for k, v in data.items() if v is not None}


def _append_change(db, user_id, seq, change, row, deleted=False):
    snapshot = {} if row is None else _mobile_data(db, change.resource, row)
    snapshot.setdefault("id", change.id)
    snapshot["_created_at"] = wire_value(row.created_at) if row is not None else None
    snapshot["_updated_at"] = (
        wire_value(row.updated_at)
        if row is not None
        else change.updated_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    )
    snapshot["_deleted_at"] = wire_value(row.deleted_at) if row is not None and row.deleted_at else None
    db.add(
        SyncChange(
            user_id=user_id,
            sync_seq=seq,
            resource=change.resource,
            record_id=change.id,
            operation="delete" if deleted else "upsert",
            snapshot=snapshot,
            created_at=utcnow(),
        )
    )


def _normalize_mobile_data(resource: str, incoming: dict[str, Any]) -> dict[str, Any]:
    aliases = MOBILE_KEYS.get(resource, {})
    values = {
        aliases.get(key, {"createdAt": "created_at"}.get(key, key)): value
        for key, value in incoming.items()
    }
    if resource == "transaction":
        if "amount" in values and "amount_paise" not in values:
            signed = values.pop("amount")
            if isinstance(signed, bool) or not isinstance(signed, int):
                raise ValueError("amount must be integer paise")
            values["amount_paise"] = abs(signed)
            values.setdefault("kind", "expense" if signed >= 0 else "income")
        values.setdefault("kind", "expense")
        if "local_date" in values:
            values["transaction_date"] = values["local_date"]
    if resource == "budget_period":
        month = values.get("month")
        day = int(values.get("start_day", 1))
        if month and ("start_date" not in values or "end_date" not in values):
            year, mon = (int(part) for part in month.split("-"))
            start = date(year, mon, day)
            if mon == 12:
                next_month = date(year + 1, 1, day)
            else:
                next_month = date(year, mon + 1, day)
            values.setdefault("start_date", start.isoformat())
            values.setdefault("end_date", (next_month - timedelta(days=1)).isoformat())
    if resource == "budget_allocation" and "month" in values and "period_id" not in values:
        pass
    if resource == "user_settings":
        toggles = values.pop("aiFeatureToggles", values.pop("ai_feature_toggles", None))
        if toggles is not None:
            values.update({
                "entry_parsing_enabled": toggles.get("entryParsing", True),
                "categorization_enabled": toggles.get("categorization", True),
                "split_drafting_enabled": toggles.get("splitDrafting", True),
                "budget_suggestions_enabled": toggles.get("budgetSuggestions", True),
                "summaries_enabled": toggles.get("summaries", True),
            })
    values.pop("is_me", None)
    return values


def _validate_resource_data(resource: str, values: dict[str, Any]) -> None:
    def integer(name: str, *, minimum: int = 0) -> int:
        value = values.get(name)
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < minimum
            or value > 9_223_372_036_854_775_807
        ):
            raise ValueError(f"validation_error: {name} must be an integer paise value")
        return value

    if resource == "category":
        if not str(values.get("name", "")).strip() or values.get("type") not in {
            "fixed",
            "variable",
            "savings",
        }:
            raise ValueError("validation_error: category name and type are required")
        if values.get("color") is not None and not re.fullmatch(
            r"#[0-9A-Fa-f]{6}", str(values["color"])
        ):
            raise ValueError("validation_error: category color must be a six-digit hex color")
    elif resource == "transaction":
        integer("amount_paise", minimum=1)
        if values.get("kind") not in {"expense", "income", "refund"}:
            raise ValueError("validation_error: unsupported transaction kind")
        if values.get("payment_mode") not in {"cash", "upi", "card"}:
            raise ValueError("validation_error: unsupported payment mode")
        if values.get("provenance") not in {"user", "ai_confirmed", "ai_edited"}:
            raise ValueError("validation_error: unsupported transaction provenance")
        if not values.get("timezone"):
            values["timezone"] = "Asia/Kolkata"
        try:
            from zoneinfo import ZoneInfo

            ZoneInfo(values["timezone"])
        except Exception as exc:
            raise ValueError("validation_error: timezone must be an IANA timezone") from exc
        if not re.fullmatch(r"\d{2}:\d{2}(?::\d{2})?", str(values.get("local_time", ""))):
            raise ValueError("validation_error: local_time must use HH:MM or HH:MM:SS")
        try:
            time.fromisoformat(values["local_time"])
        except ValueError as exc:
            raise ValueError("validation_error: local_time is not a valid clock time") from exc
        if values.get("local_date") is None and values.get("transaction_date") is None:
            raise ValueError("validation_error: transaction date is required")
    elif resource == "budget_period":
        integer("total_paise")
        if values.get("end_date") < values.get("start_date"):
            raise ValueError("invariant_violation: end_date cannot be before start_date")
        if values.get("status", "open") not in {"open", "closed"}:
            raise ValueError("validation_error: invalid budget period status")
    elif resource == "budget_allocation":
        integer("amount_paise")
    elif resource == "budget_transfer":
        integer("amount_paise", minimum=1)
        if values.get("from_category_id") == values.get("to_category_id"):
            raise ValueError("invariant_violation: transfer categories must differ")
    elif resource == "person":
        if not str(values.get("name", "")).strip():
            raise ValueError("validation_error: person name is required")
    elif resource == "group_bill":
        people = values.get("person_ids")
        payments = values.get("payments")
        if not isinstance(people, list) or not people or len(set(people)) != len(people):
            raise ValueError("invariant_violation: group bill requires unique participants")
        if not isinstance(payments, dict):
            raise ValueError("validation_error: payments must be a person-to-paise map")
        if any(
            isinstance(amount, bool) or not isinstance(amount, int) or amount < 0
            for amount in payments.values()
        ):
            raise ValueError("invariant_violation: payer amounts must be nonnegative integer paise")
        if sum(payments.values()) <= 0:
            raise ValueError("invariant_violation: group bill total must be positive integer paise")
        if values.get("method") not in {"equal", "custom", "percent", "shares", "itemized"}:
            raise ValueError("validation_error: invalid split method")
        if not str(values.get("title", "")).strip():
            raise ValueError("validation_error: bill title is required")
        if (
            not isinstance(values.get("tax_paise"), int)
            or isinstance(values.get("tax_paise"), bool)
            or values["tax_paise"] < 0
        ):
            raise ValueError("invariant_violation: tax must be nonnegative integer paise")
        if (
            not isinstance(values.get("tip_paise"), int)
            or isinstance(values.get("tip_paise"), bool)
            or values["tip_paise"] < 0
        ):
            raise ValueError("invariant_violation: tip must be nonnegative integer paise")
        if integer("tax_paise") < 0 or integer("tip_paise") < 0:
            raise ValueError("invariant_violation: tax and tip must be nonnegative")
    elif resource == "settlement":
        amount = integer("amount_paise", minimum=1)
        paid = integer("paid_amount_paise")
        if paid > amount:
            raise ValueError("invariant_violation: paid amount cannot exceed settlement amount")
    elif resource == "attachment":
        integer("size_bytes")
        if values.get("mime_type") not in {"image/jpeg", "image/png", "image/webp"}:
            raise ValueError("validation_error: unsupported attachment MIME type")
        if not re.fullmatch(r"[0-9a-fA-F]{64}", str(values.get("checksum_sha256", ""))):
            raise ValueError("validation_error: checksum_sha256 must be a SHA-256 hex digest")
        if values.get("upload_status") not in {"pending", "uploaded", "failed"}:
            raise ValueError("validation_error: invalid attachment status")
    elif resource == "user_settings":
        if not 1 <= int(values.get("budget_start_day", 1)) <= 28:
            raise ValueError("validation_error: budget_start_day must be between 1 and 28")
        for name in (
            "ai_enabled",
            "entry_parsing_enabled",
            "categorization_enabled",
            "split_drafting_enabled",
            "budget_suggestions_enabled",
            "summaries_enabled",
        ):
            if name in values and not isinstance(values[name], bool):
                raise ValueError(f"validation_error: {name} must be boolean")
    elif resource == "place_rule":
        if not str(values.get("place_pattern", "")).strip():
            raise ValueError("validation_error: place_pattern is required")


def _apply_one(db: Session, user: User, change, now: datetime) -> dict[str, Any]:
    model = RESOURCE_MODELS[change.resource]
    if change.resource == "person" and change.id == "me":
        raise ValueError("reserved participant id")
    if change.resource == "person":
        row_id = change.id
        row = db.scalar(
            select(model).where(model.id == row_id, model.user_id == user.id).with_for_update()
        )
    elif change.resource == "category" and re.fullmatch(r"cat-[0-8]", change.id):
        row = db.scalar(
            select(Category)
            .where(Category.user_id == user.id, Category.sort_order == int(change.id[4:]))
            .with_for_update()
        )
        if row is None:
            raise ValueError("missing_reference: legacy default category alias not found")
        row_id = row.id
    else:
        row_id = uuid.UUID(change.id)
        row = db.scalar(
            select(model).where(model.id == row_id, model.user_id == user.id).with_for_update()
        )
    latest_tombstone = db.scalar(
        select(SyncChange)
        .where(
            SyncChange.user_id == user.id,
            SyncChange.resource == change.resource,
            SyncChange.record_id == change.id,
            SyncChange.operation == "delete",
        )
        .order_by(SyncChange.sync_seq.desc())
        .limit(1)
    )
    client_time = change.updated_at.astimezone(UTC)
    if client_time > now + timedelta(minutes=5):
        client_time = now
    if latest_tombstone and row is None:
        deleted_time = datetime.fromisoformat(
            latest_tombstone.snapshot.get(
                "_updated_at", latest_tombstone.created_at.isoformat()
            ).replace("Z", "+00:00")
        )
        if client_time <= deleted_time:
            return {
                "resource": change.resource,
                "id": change.id,
                "status": "stale",
                "sync_seq": None,
                "reason_code": "stale",
            }
    row_updated = aware(row.updated_at) if row is not None else None
    if row is not None and change.op == "delete" and client_time <= row_updated:
        if client_time == row_updated and row.deleted_at is not None:
            return {
                "resource": change.resource,
                "id": change.id,
                "status": "unchanged",
                "sync_seq": row.sync_seq,
                "reason_code": None,
            }
        return {
            "resource": change.resource,
            "id": change.id,
            "status": "stale",
            "sync_seq": row.sync_seq,
            "reason_code": "stale",
        }
    if change.op == "delete":
        if row is not None:
            row.updated_at = client_time
            row.deleted_at = client_time
        seq = next_sync_seq(db, user.id)
        if row is not None:
            row.sync_seq = seq
        _append_change(db, user.id, seq, change, row, deleted=True)
        return {
            "resource": change.resource,
            "id": change.id,
            "status": "applied",
            "sync_seq": seq,
            "reason_code": None,
        }
    values = _normalize_mobile_data(change.resource, change.data)
    if "id" in values and str(values.pop("id")) != change.id:
        raise ValueError("validation_error: data.id must match the envelope id")
    if change.resource == "person" and change.data.get("isMe") is True:
        raise ValueError("invariant_violation: me is a reserved participant and cannot be stored")
    if change.resource == "transaction" and values.get("attachment_id"):
        attachment_ref = str(values["attachment_id"])
        if attachment_ref.startswith("attachment:"):
            values["attachment_id"] = attachment_ref.removeprefix("attachment:")
        if not re.fullmatch(r"[0-9a-fA-F-]{36}", str(values["attachment_id"])):
            raise ValueError(
                "missing_reference: billPhotoUri must refer to an uploaded attachment id"
            )
    protected = {"id", "user_id", "sync_seq", "updated_at", "deleted_at", "storage_key"}
    if set(values) & protected:
        raise ValueError("server-controlled or immutable fields in data")
    valid = {c.name: c for c in model.__table__.columns}
    if change.resource == "user_settings":
        values = {
            k: v
            for k, v in values.items()
            if k
            in {
                "budget_start_day",
                "ai_enabled",
                "entry_parsing_enabled",
                "categorization_enabled",
                "split_drafting_enabled",
                "budget_suggestions_enabled",
                "summaries_enabled",
            }
        }
    if change.resource == "group_bill":
        values.setdefault("tax_paise", 0)
        values.setdefault("tip_paise", 0)
        if "split_method" in values and "method" not in values:
            values["method"] = values.pop("split_method")
        if "payers" in values and "payments" not in values:
            payers = values.pop("payers")
            values["payments"] = {p["person_id"]: p["amount_paise"] for p in payers}
        payments = values.get("payments", {})
        total = sum(payments.values()) if isinstance(payments, dict) else -1
        if any(
            isinstance(value, bool) or not isinstance(value, int) or value < 0
            for value in (payments.values() if isinstance(payments, dict) else [])
        ):
            raise ValueError("invariant_violation: payer amounts must be nonnegative integer paise")
        if "total_paise" in values and values["total_paise"] != total:
            raise ValueError("invariant_violation: payer amounts must sum to total_paise")
        if "shares" in values:
            shares = values.pop("shares")
            if (
                not isinstance(shares, list)
                or any(
                    not isinstance(s, dict)
                    or isinstance(s.get("amount_paise"), bool)
                    or not isinstance(s.get("amount_paise"), int)
                    or s["amount_paise"] <= 0
                    for s in shares
                )
                or sum(s["amount_paise"] for s in shares) != total
            ):
                raise ValueError("invariant_violation: shares must sum to total_paise")
        values.pop("total_paise", None)
        if set(payments) - set(values.get("person_ids", [])):
            raise ValueError("invariant_violation: payers must be participants")
        for person_id in values.get("person_ids", []):
            if (
                person_id != "me"
                and db.scalar(
                    select(Person.id).where(Person.user_id == user.id, Person.id == person_id)
                )
                is None
            ):
                raise ValueError("missing_reference: group bill participant does not exist")
        for item in values.get("items") or []:
            if not isinstance(item, dict):
                raise TypeError("validation_error: group bill items must be objects")
            amount = item.get("amountPaise", item.get("amount_paise"))
            if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
                raise ValueError(
                    "invariant_violation: item amounts must be positive integer paise"
                )
            if set(item.get("assignedPersonIds", [])) - set(values.get("person_ids", [])):
                raise ValueError("invariant_violation: item assignees must be participants")
    if change.resource == "budget_allocation" and "period_id" not in values and "month" in values:
        month = values.pop("month")
        month_str = str(month)[:7]
        period = db.scalar(
            select(BudgetPeriod).where(
                BudgetPeriod.user_id == user.id,
                BudgetPeriod.month == month_str,
                BudgetPeriod.deleted_at.is_(None),
            )
        )
        if period is None:
            year, mon = (int(part) for part in month_str.split("-"))
            start = date(year, mon, 1)
            next_month = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
            end = next_month - timedelta(days=1)
            period = BudgetPeriod(
                id=uuid.uuid4(),
                user_id=user.id,
                month=month_str,
                start_day=1,
                start_date=start,
                end_date=end,
                total_paise=0,
                status="open",
                created_at=client_time,
                updated_at=client_time,
                sync_seq=next_sync_seq(db, user.id),
            )
            db.add(period)
            db.flush()
        values["period_id"] = str(period.id)
    category_fields = {"category_id", "from_category_id", "to_category_id"} & set(values)
    for field in category_fields:
        category_value = values[field]
        legacy = re.fullmatch(r"cat-([0-8])", str(category_value))
        if legacy:
            category = db.scalar(
                select(Category).where(
                    Category.user_id == user.id, Category.sort_order == int(legacy.group(1))
                )
            )
            if category is None:
                raise ValueError("missing_reference: category does not exist")
            values[field] = category.id
        elif category_value is not None:
            values[field] = uuid.UUID(str(category_value))
    unknown = set(values) - set(valid)
    if unknown:
        raise ValueError(f"unknown fields: {', '.join(sorted(unknown))}")
    for key, column in valid.items():
        if key in values:
            values[key] = parse_value(column, values[key])
    if "created_at" in values:
        if values["created_at"].tzinfo is None or values["created_at"].utcoffset() is None:
            raise ValueError("validation_error: created_at must include a UTC offset")
        values["created_at"] = aware(values["created_at"])
    if row is None and "created_at" not in values and change.resource != "user_settings":
        raise ValueError("validation_error: created_at is required for a new synced record")
    _validate_resource_data(change.resource, values)
    if row is not None and client_time <= row_updated:
        if client_time == row_updated and change.op == "delete" and row.deleted_at is not None:
            return {
                "resource": change.resource,
                "id": change.id,
                "status": "unchanged",
                "sync_seq": row.sync_seq,
                "reason_code": None,
            }
        if client_time == row_updated and all(
            wire_value(getattr(row, key)) == wire_value(value) for key, value in values.items()
        ):
            return {
                "resource": change.resource,
                "id": change.id,
                "status": "unchanged",
                "sync_seq": row.sync_seq,
                "reason_code": None,
            }
        return {
            "resource": change.resource,
            "id": change.id,
            "status": "stale",
            "sync_seq": row.sync_seq,
            "reason_code": "stale",
        }
    if change.resource in INSERT_ONLY and row is not None:
        canonical = {key: wire_value(getattr(row, key)) for key in values}
        if canonical == values:
            return {
                "resource": change.resource,
                "id": change.id,
                "status": "unchanged",
                "sync_seq": row.sync_seq,
                "reason_code": None,
            }
        mutable = (
            {"voided_at"}
            if change.resource == "budget_transfer"
            else {"paid_amount_paise", "is_paid", "paid_at", "voided_at"}
        )
        if set(values) <= mutable:
            if change.resource == "budget_transfer":
                row.voided_at = parse_value(valid["voided_at"], values.get("voided_at"))
            else:
                if "paid_amount_paise" in values:
                    values["paid_amount_paise"] = max(
                        row.paid_amount_paise, int(values["paid_amount_paise"])
                    )
                for key in ("is_paid", "paid_at", "voided_at"):
                    if key in values:
                        setattr(row, key, parse_value(valid[key], values[key]))
                values = {
                    "paid_amount_paise": values.get("paid_amount_paise", row.paid_amount_paise)
                }
        else:
            raise ValueError("insert-only record already exists with different content")
    if change.resource == "settlement":
        bill = db.scalar(
            select(GroupBill).where(
                GroupBill.id == values.get("group_bill_id"), GroupBill.user_id == user.id
            )
        )
        if bill is None:
            raise ValueError("missing_reference: settlement group bill does not exist")
        participants = set(bill.person_ids or [])
        if (
            values.get("from_person_id") not in participants
            or values.get("to_person_id") not in participants
        ):
            raise ValueError(
                "invariant_violation: settlement endpoints must be bill participants"
            )
    if change.resource == "budget_period" and row is None and "start_date" in values:
        existing_period = db.scalar(
            select(BudgetPeriod)
            .where(
                BudgetPeriod.user_id == user.id,
                BudgetPeriod.start_date == values["start_date"],
                BudgetPeriod.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if existing_period is not None:
            row = existing_period
            row_id = existing_period.id

    if (
        change.resource == "budget_allocation"
        and row is None
        and "period_id" in values
        and "category_id" in values
    ):
        existing_alloc = db.scalar(
            select(BudgetAllocation)
            .where(
                BudgetAllocation.user_id == user.id,
                BudgetAllocation.period_id == values["period_id"],
                BudgetAllocation.category_id == values["category_id"],
                BudgetAllocation.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if existing_alloc is not None:
            row = existing_alloc
            row_id = existing_alloc.id

    values.update(id=row_id, user_id=user.id, updated_at=client_time, deleted_at=None)
    if row is None:
        values.setdefault("created_at", client_time)
        values["sync_seq"] = 0
        row = model(**values)
        db.add(row)
    else:
        for key, value in values.items():
            if key not in {"id", "user_id", "created_at", "sync_seq"}:
                setattr(row, key, value)
    db.flush()
    seq = next_sync_seq(db, user.id)
    row.sync_seq = seq
    db.flush()
    _append_change(db, user.id, seq, change, row)
    return {
        "resource": change.resource,
        "id": change.id,
        "status": "applied",
        "sync_seq": seq,
        "reason_code": None,
    }


async def sync_push_service(
    payload, request, user: User, db: Session
) -> dict[str, Any]:
    from expense_tracker_api.core.config import MAX_SYNC_REQUEST_BYTES

    if len(await request.body()) > MAX_SYNC_REQUEST_BYTES:
        error(413, "payload_too_large", "Sync request exceeds configured body limit")
    results: dict[int, dict[str, Any]] = {}
    groups: dict[str, list[tuple[int, Any]]] = {}
    for index, change in enumerate(payload.changes):
        if change.group_id:
            groups.setdefault(change.group_id, []).append((index, change))
        else:
            try:
                with db.begin_nested():
                    result = _apply_one(db, user, change, utcnow())
                    db.flush()
                results[index] = result
            except (ValueError, TypeError, IntegrityError) as exc:
                results[index] = {
                    "resource": change.resource,
                    "id": change.id,
                    "status": "rejected",
                    "sync_seq": None,
                    "reason_code": _reason(exc),
                    "message": str(exc)[:200],
                }
    for group_changes in groups.values():
        try:
            with db.begin_nested():
                for index, change in sorted(
                    group_changes, key=lambda item: ORDER[item[1].resource]
                ):
                    result = _apply_one(db, user, change, utcnow())
                    results[index] = result
                    if result["status"] == "stale":
                        raise AtomicGroupConflict(
                            "stale: one or more group records have newer versions"
                        )
                db.flush()
        except (ValueError, TypeError, IntegrityError) as exc:
            code = _reason(exc)
            for index, change in group_changes:
                results[index] = {
                    "resource": change.resource,
                    "id": change.id,
                    "status": "rejected",
                    "sync_seq": None,
                    "reason_code": code,
                    "message": str(exc)[:200],
                }
    db.commit()
    return {"results": [results[i] for i in range(len(payload.changes))]}


def sync_pull_service(
    cursor: int, limit: int, user: User, db: Session
) -> dict[str, Any]:
    state = db.get(UserSyncState, user.id)
    retained_from = state.retained_from_seq if state else 0
    cutoff = utcnow() - timedelta(days=SYNC_TOMBSTONE_DAYS)
    storage_keys = _purge_tombstones(db, user.id, cutoff)
    expired = list(
        db.scalars(
            select(SyncChange).where(
                SyncChange.user_id == user.id, SyncChange.created_at < cutoff
            )
        )
    )
    if expired:
        if state is not None:
            state.retained_from_seq = max(
                state.retained_from_seq, max(row.sync_seq for row in expired)
            )
        for row in expired:
            db.delete(row)
        db.flush()
        retained_from = state.retained_from_seq if state else retained_from
    if cursor and cursor < retained_from:
        if expired or storage_keys:
            db.commit()
            if storage_keys:
                from expense_tracker_api.features.attachments.service import get_storage

                storage = get_storage()
                for key in storage_keys:
                    storage.delete(key)
        error(410, "cursor_too_old", "Cursor is outside retained sync history; perform a full pull")
    if cursor == 0:
        rows = []
        for resource, model in RESOURCE_MODELS.items():
            query = select(model).where(model.user_id == user.id, model.sync_seq > 0)
            for row in db.scalars(query):
                snapshot = _mobile_data(db, resource, row)
                rows.append((
                    row.sync_seq,
                    resource,
                    snapshot.get("id", str(row.id)),
                    "delete" if row.deleted_at else "upsert",
                    snapshot,
                    row.created_at,
                    row.updated_at,
                    row.deleted_at,
                ))
        rows.sort(key=lambda item: item[0])
        page = rows[:limit]
        more = len(rows) > limit
        if expired or storage_keys:
            db.commit()
            if storage_keys:
                from expense_tracker_api.features.attachments.service import get_storage

                storage = get_storage()
                for key in storage_keys:
                    storage.delete(key)
        return {
            "changes": [
                {
                    "resource": resource,
                    "id": record_id,
                    "op": op,
                    "sync_seq": seq,
                    "created_at": wire_value(created),
                    "updated_at": wire_value(updated),
                    "deleted_at": wire_value(deleted) if deleted else None,
                    "data": snapshot,
                }
                for seq, resource, record_id, op, snapshot, created, updated, deleted in page
            ],
            "next_cursor": page[-1][0] if page else 0,
            "has_more": more,
        }
    rows = list(
        db.scalars(
            select(SyncChange)
            .where(SyncChange.user_id == user.id, SyncChange.sync_seq > cursor)
            .order_by(SyncChange.sync_seq)
            .limit(limit + 1)
        )
    )
    more = len(rows) > limit
    page = rows[:limit]
    changes = []
    for row in page:
        snapshot = dict(row.snapshot)
        created_at = snapshot.pop("_created_at", None)
        updated_at = snapshot.pop("_updated_at", snapshot.pop("updated_at", None))
        deleted_at = snapshot.pop("_deleted_at", None)
        changes.append({
            "resource": row.resource,
            "id": row.record_id,
            "op": row.operation,
            "sync_seq": row.sync_seq,
            "created_at": created_at,
            "updated_at": updated_at,
            "deleted_at": deleted_at,
            "data": snapshot,
        })
    if expired or storage_keys:
        db.commit()
        if storage_keys:
            from expense_tracker_api.features.attachments.service import get_storage

            storage = get_storage()
            for key in storage_keys:
                storage.delete(key)
    return {
        "changes": changes,
        "next_cursor": page[-1].sync_seq if page else cursor,
        "has_more": more,
    }
