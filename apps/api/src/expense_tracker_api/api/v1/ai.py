from __future__ import annotations

import re
import time
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from expense_tracker_api.ai.providers import get_provider, model_for
from expense_tracker_api.core.config import AI_REQUESTS_PER_DAY, AI_REQUESTS_PER_MINUTE
from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.models import AIUsage, User, UserSettings, utcnow
from expense_tracker_api.schemas_v2 import (
    AskIn,
    DraftSplitIn,
    NarrativeIn,
    ProposeBudgetIn,
    QueryDraft,
    ReceiptDraft,
    SuggestCategoryIn,
    TransactionDraft,
)

router = APIRouter(prefix="/ai", tags=["ai"])
FEATURE = {"parse-entry": "entry_parsing_enabled", "suggest-category": "categorization_enabled",
           "propose-budget": "budget_suggestions_enabled", "draft-split": "split_drafting_enabled",
           "ask": "summaries_enabled", "month-narrative": "summaries_enabled",
           "parse-receipt": "entry_parsing_enabled"}
OUTPUT_MODELS = {"parse-entry": TransactionDraft, "ask": QueryDraft, "parse-receipt": ReceiptDraft}


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
    minute = db.scalar(select(func.count(AIUsage.id)).where(AIUsage.user_id == user.id, AIUsage.created_at >= now - timedelta(minutes=1))) or 0
    daily = db.scalar(select(func.count(AIUsage.id)).where(AIUsage.user_id == user.id, AIUsage.created_at >= now - timedelta(days=1))) or 0
    if minute >= AI_REQUESTS_PER_MINUTE or daily >= AI_REQUESTS_PER_DAY:
        raise HTTPException(429, detail={"code":"ai_rate_limited", "message":"AI usage limit reached", "details":[]}, headers={"Retry-After":"60"})


def _invoke(operation: str, body: dict[str, Any], schema, user: User, db: Session):
    settings = _settings(db, user)
    feature = FEATURE[operation]
    if not settings.ai_enabled or not getattr(settings, feature):
        raise HTTPException(503, detail={"code":"ai_unavailable", "message":"This AI feature is disabled", "details":[]})
    _limit(db, user)
    try:
        provider = get_provider()
    except RuntimeError as exc:
        raise HTTPException(503, detail={"code":"ai_unavailable", "message":"AI provider is unavailable", "details":[]}) from exc
    model = model_for(operation)
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
            db.add(AIUsage(user_id=user.id, endpoint=operation, model=result.model,
                           tokens_in=result.tokens_in, tokens_out=result.tokens_out,
                           latency_ms=result.latency_ms, status="success", created_at=utcnow()))
            db.commit()
            output_type = {"parse-entry":"transaction", "suggest-category":"category", "propose-budget":"budget_allocations",
                           "draft-split":"group_bill", "ask":"query", "month-narrative":"narrative", "parse-receipt":"receipt"}[operation]
            return {"type": output_type, "payload": obj, "confidence": max(0.0,min(1.0,result.confidence)),
                    "reason": result.reason, "provider": result.provider, "latency_ms": result.latency_ms}
        except (ValidationError, ValueError, TypeError) as exc:
            final_error = exc
        except Exception as exc:
            db.add(AIUsage(user_id=user.id, endpoint=operation, model=model,
                           latency_ms=int((time.monotonic()-started)*1000), status="provider_error", created_at=utcnow()))
            db.commit()
            raise HTTPException(503, detail={"code":"ai_unavailable", "message":"AI provider request failed", "details":[]}) from exc
    db.add(AIUsage(user_id=user.id, endpoint=operation, model=model, latency_ms=int((time.monotonic()-started)*1000), status="invalid_output", created_at=utcnow()))
    db.commit()
    raise HTTPException(503, detail={"code":"ai_unavailable", "message":"AI returned invalid structured output", "details":[]}) from final_error


def _fit_budget(payload: dict[str, Any], total: int) -> dict[str, Any]:
    allocations = payload.get("allocations", [])
    if any(isinstance(a.get("amount_paise"), bool) or not isinstance(a.get("amount_paise"), int) or a["amount_paise"] < 0 for a in allocations):
        raise ValueError("invalid allocation amount")
    summed = sum(a["amount_paise"] for a in allocations)
    if summed > total:
        # Deterministic proportional integer scaling, assigning leftover by stable input order.
        if summed == 0:
            return payload
        bases = [total * a["amount_paise"] // summed for a in allocations]
        remainder = total - sum(bases)
        remainders = sorted(range(len(allocations)), key=lambda i: (-(total * allocations[i]["amount_paise"] % summed), i))
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
    # Every numeric token must exactly match a value from the report.
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
        payload["text"] = (f"You recorded {_money(total)} in spending for {month}. "
                            "Review your category breakdown for details. Check that recent entries are accurate.")
        payload["suggestions"] = []
    payload["suggestions"] = payload.get("suggestions", [])[:3]
    return payload


@router.post("/parse-entry")
def parse_entry(payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from expense_tracker_api.schemas_v2 import ParseEntryIn
    body = ParseEntryIn.model_validate(payload)
    return _invoke("parse-entry", body.model_dump(mode="json"), TransactionDraft, user, db)


@router.post("/suggest-category")
def suggest_category(payload: SuggestCategoryIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    class CategoryDraft(BaseModel):
        model_config = {"extra":"forbid"}
        category_id: str | None
    return _invoke("suggest-category", payload.model_dump(mode="json"), CategoryDraft, user, db)


@router.post("/propose-budget")
def propose_budget(payload: ProposeBudgetIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    class Allocation(BaseModel):
        model_config = {"extra":"forbid"}
        category_id: str
        amount_paise: int
        reason: str
    class BudgetDraft(BaseModel):
        model_config = {"extra":"forbid"}
        allocations: list[Allocation]
    return _invoke("propose-budget", payload.model_dump(mode="json"), BudgetDraft, user, db)


@router.post("/draft-split")
def draft_split(payload: DraftSplitIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    class SplitDraft(BaseModel):
        model_config = {"extra":"forbid"}
        title: str
        date: str
        person_ids: list[str]
        payments: dict[str, int]
        method: str
        is_settled: bool
        unmatched_names: list[str] = []
    return _invoke("draft-split", payload.model_dump(mode="json"), SplitDraft, user, db)


@router.post("/ask")
def ask(payload: AskIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _invoke("ask", payload.model_dump(mode="json"), QueryDraft, user, db)


@router.post("/month-narrative")
def month_narrative(payload: NarrativeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    class NarrativeDraft(BaseModel):
        model_config = {"extra":"forbid"}
        text: str
        suggestions: list[str] = []
    return _invoke("month-narrative", payload.model_dump(mode="json"), NarrativeDraft, user, db)


@router.post("/parse-receipt")
async def parse_receipt(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    import base64
    import uuid as uuid_module

    from expense_tracker_api.api.v1.attachments import get_storage
    from expense_tracker_api.models import Attachment
    from expense_tracker_api.services.storage import sanitize_image
    content_type = request.headers.get("content-type", "")
    try:
        if int(request.headers.get("content-length", "0")) > 5 * 1024 * 1024 + 65536:
            raise HTTPException(413, detail={"code":"payload_too_large", "message":"Receipt exceeds 5 MiB", "details":[]})
    except ValueError:
        pass
    raw = b""
    mime = ""
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(422, detail={"code":"validation_error", "message":"multipart field 'file' is required", "details":[]})
        raw = await upload.read(5 * 1024 * 1024 + 1)
        if len(raw) > 5 * 1024 * 1024:
            raise HTTPException(413, detail={"code":"payload_too_large", "message":"Receipt exceeds 5 MiB", "details":[]})
        mime = upload.content_type or ""
    else:
        body = await request.json()
        attachment_id = body.get("attachment_id")
        if not attachment_id:
            raise HTTPException(422, detail={"code":"validation_error", "message":"attachment_id is required", "details":[]})
        try:
            record = db.scalar(select(Attachment).where(Attachment.id == uuid_module.UUID(attachment_id), Attachment.user_id == user.id, Attachment.upload_status == "uploaded"))
        except ValueError as exc:
            raise HTTPException(422, detail={"code":"validation_error", "message":"attachment_id must be a UUID", "details":[]}) from exc
        if record is None:
            raise HTTPException(404, detail={"code":"not_found", "message":"Attachment not found", "details":[]})
        raw = get_storage().get(str(record.id))
        mime = record.mime_type
    try:
        clean, mime = sanitize_image(raw, mime)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(422, detail={"code":"invalid_image", "message":str(exc), "details":[]}) from exc
    return _invoke("parse-receipt", {"image_base64":base64.b64encode(clean).decode("ascii"), "mime_type":mime}, ReceiptDraft, user, db)
