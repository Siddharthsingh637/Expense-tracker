from __future__ import annotations

import re
import time
from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from expense_tracker_api.ai.providers import get_provider, model_for
from expense_tracker_api.core.config import AI_REQUESTS_PER_DAY, AI_REQUESTS_PER_MINUTE
from expense_tracker_api.models import AIUsage, User, UserSettings, utcnow

FEATURE = {
    "parse-entry": "entry_parsing_enabled",
    "suggest-category": "categorization_enabled",
    "propose-budget": "budget_suggestions_enabled",
    "draft-split": "split_drafting_enabled",
    "ask": "summaries_enabled",
    "month-narrative": "summaries_enabled",
    "parse-receipt": "entry_parsing_enabled",
}


def _settings(db: Session, user: User) -> UserSettings:
    row = db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    if row is None:
        row = UserSettings(user_id=user.id)
        db.add(row)
        db.flush()
    return row


def _limit(db: Session, user: User):
    now = utcnow()
    db.scalar(select(User.id).where(User.id == user.id).with_for_update())
    minute = (
        db.scalar(
            select(func.count(AIUsage.id)).where(
                AIUsage.user_id == user.id, AIUsage.created_at >= now - timedelta(minutes=1)
            )
        )
        or 0
    )
    daily = (
        db.scalar(
            select(func.count(AIUsage.id)).where(
                AIUsage.user_id == user.id, AIUsage.created_at >= now - timedelta(days=1)
            )
        )
        or 0
    )
    import sys
    mod = sys.modules.get("expense_tracker_api.api.v1.ai")
    rpm = getattr(mod, "AI_REQUESTS_PER_MINUTE", AI_REQUESTS_PER_MINUTE) if mod else AI_REQUESTS_PER_MINUTE
    rpd = getattr(mod, "AI_REQUESTS_PER_DAY", AI_REQUESTS_PER_DAY) if mod else AI_REQUESTS_PER_DAY
    if minute >= rpm or daily >= rpd:
        raise HTTPException(
            429,
            detail={"code": "ai_rate_limited", "message": "AI usage limit reached", "details": []},
            headers={"Retry-After": "60"},
        )


def _fit_budget(payload: dict[str, Any], total: int) -> dict[str, Any]:
    allocations = payload.get("allocations", [])
    if any(
        isinstance(a.get("amount_paise"), bool)
        or not isinstance(a.get("amount_paise"), int)
        or a["amount_paise"] < 0
        for a in allocations
    ):
        raise ValueError("invalid allocation amount")
    summed = sum(a["amount_paise"] for a in allocations)
    if summed > total:
        if summed == 0:
            return payload
        bases = [total * a["amount_paise"] // summed for a in allocations]
        remainder = total - sum(bases)
        remainders = sorted(
            range(len(allocations)),
            key=lambda i: (-(total * allocations[i]["amount_paise"] % summed), i),
        )
        for i in remainders[:remainder]:
            bases[i] += 1
        for a, amount in zip(allocations, bases):
            a["amount_paise"] = amount
    return payload


def _money(paise: int) -> str:
    return f"₹{paise // 100:,}.{paise % 100:02d}"


def _check_narrative(payload: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    text = payload.get("text", "")
    sentence_count = len([part for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part])

    def report_numbers(value):
        if isinstance(value, dict):
            for child in value.values():
                yield from report_numbers(child)
        elif isinstance(value, list):
            for child in value:
                yield from report_numbers(child)
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            yield value

    report_values = list(report_numbers(report))
    known = {str(value) for value in report_values}
    known |= {_money(int(value)) for value in report_values if isinstance(value, int) and value >= 0}
    without_dates = re.sub(r"\b\d{4}-\d{2}(?:-\d{2})?\b", "", text)
    numbers = re.findall(r"(₹\s*)?(\d[\d,]*(?:\.\d+)?)(%)?", without_dates)
    normalized_known = {x.replace(",", "").replace("%", "") for x in known}
    invalid = False
    for currency, number, percent in numbers:
        normalized = number.replace(",", "")
        if currency:
            try:
                rupees, _, paisa = normalized.partition(".")
                as_paise = str(int(rupees) * 100 + int((paisa + "00")[:2]))
            except ValueError:
                invalid = True
                break
            if as_paise not in normalized_known:
                invalid = True
                break
        elif normalized not in normalized_known:
            invalid = True
            break
    if invalid or not 3 <= sentence_count <= 5:
        month = str(report.get("month", "this month"))
        total = int(report.get("totalSpentPaise", 0))
        payload["text"] = (
            f"You recorded {_money(total)} in spending for {month}. "
            "Review your category breakdown for details. Check that recent entries are accurate."
        )
        payload["suggestions"] = []
    payload["suggestions"] = payload.get("suggestions", [])[:3]
    return payload


def invoke_ai(operation: str, body: dict[str, Any], schema, user: User, db: Session):
    settings = _settings(db, user)
    feature = FEATURE[operation]
    if not settings.ai_enabled or not getattr(settings, feature):
        raise HTTPException(
            503,
            detail={"code": "ai_unavailable", "message": "This AI feature is disabled", "details": []},
        )
    _limit(db, user)
    import sys
    mod = sys.modules.get("expense_tracker_api.api.v1.ai")
    provider_fn = getattr(mod, "get_provider", get_provider) if mod else get_provider
    model_fn = getattr(mod, "model_for", model_for) if mod else model_for
    try:
        provider = provider_fn()
    except RuntimeError as exc:
        raise HTTPException(
            503,
            detail={"code": "ai_unavailable", "message": "AI provider is unavailable", "details": []},
        ) from exc
    model = model_fn(operation)
    started = time.monotonic()
    final_error = None
    for attempt in range(2):
        try:
            provider_body = {**body, "_repair_output": attempt == 1}
            result = provider.generate(operation, provider_body, model)
            payload = schema.model_validate(result.payload)
            obj = payload.model_dump(mode="json")
            if operation == "propose-budget":
                obj = _fit_budget(obj, body["total_paise"])
            if operation == "month-narrative":
                obj = _check_narrative(obj, body["report"])
            db.add(
                AIUsage(
                    user_id=user.id,
                    endpoint=operation,
                    model=result.model,
                    tokens_in=result.tokens_in,
                    tokens_out=result.tokens_out,
                    latency_ms=result.latency_ms,
                    status="success",
                    created_at=utcnow(),
                )
            )
            db.commit()
            output_type = {
                "parse-entry": "transaction",
                "suggest-category": "category",
                "propose-budget": "budget_allocations",
                "draft-split": "group_bill",
                "ask": "query",
                "month-narrative": "narrative",
                "parse-receipt": "receipt",
            }[operation]
            return {
                "type": output_type,
                "payload": obj,
                "confidence": max(0.0, min(1.0, result.confidence)),
                "reason": result.reason,
                "provider": result.provider,
                "latency_ms": result.latency_ms,
            }
        except (ValidationError, ValueError, TypeError) as exc:
            final_error = exc
        except Exception as exc:
            db.add(
                AIUsage(
                    user_id=user.id,
                    endpoint=operation,
                    model=model,
                    latency_ms=int((time.monotonic() - started) * 1000),
                    status="provider_error",
                    created_at=utcnow(),
                )
            )
            db.commit()
            raise HTTPException(
                503,
                detail={"code": "ai_unavailable", "message": "AI provider request failed", "details": []},
            ) from exc
    db.add(
        AIUsage(
            user_id=user.id,
            endpoint=operation,
            model=model,
            latency_ms=int((time.monotonic() - started) * 1000),
            status="invalid_output",
            created_at=utcnow(),
        )
    )
    db.commit()
    raise HTTPException(
        503,
        detail={"code": "ai_unavailable", "message": "AI returned invalid structured output", "details": []},
    ) from final_error
