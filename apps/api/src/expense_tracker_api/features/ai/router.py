from __future__ import annotations

import base64
import uuid as uuid_module

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.features.ai.schemas import (
    Allocation,
    AskIn,
    BudgetDraft,
    CategoryDraft,
    DraftSplitIn,
    NarrativeDraft,
    NarrativeIn,
    ParseEntryIn,
    ProposeBudgetIn,
    QueryDraft,
    ReceiptDraft,
    SplitDraft,
    SuggestCategoryIn,
    TransactionDraft,
)
from expense_tracker_api.features.ai.service import invoke_ai
from expense_tracker_api.features.attachments.service import get_storage
from expense_tracker_api.models import Attachment, User
from expense_tracker_api.services.storage import sanitize_image

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/parse-entry")
def parse_entry(
    payload: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    body = ParseEntryIn.model_validate(payload)
    return invoke_ai("parse-entry", body.model_dump(mode="json"), TransactionDraft, user, db)


@router.post("/suggest-category")
def suggest_category(
    payload: SuggestCategoryIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return invoke_ai("suggest-category", payload.model_dump(mode="json"), CategoryDraft, user, db)


@router.post("/propose-budget")
def propose_budget(
    payload: ProposeBudgetIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return invoke_ai("propose-budget", payload.model_dump(mode="json"), BudgetDraft, user, db)


@router.post("/draft-split")
def draft_split(
    payload: DraftSplitIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return invoke_ai("draft-split", payload.model_dump(mode="json"), SplitDraft, user, db)


@router.post("/ask")
def ask(
    payload: AskIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return invoke_ai("ask", payload.model_dump(mode="json"), QueryDraft, user, db)


@router.post("/month-narrative")
def month_narrative(
    payload: NarrativeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return invoke_ai("month-narrative", payload.model_dump(mode="json"), NarrativeDraft, user, db)


@router.post("/parse-receipt")
async def parse_receipt(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content_type = request.headers.get("content-type", "")
    try:
        if int(request.headers.get("content-length", "0")) > 5 * 1024 * 1024 + 65536:
            raise HTTPException(
                413, detail={"code": "payload_too_large", "message": "Receipt exceeds 5 MiB", "details": []}
            )
    except ValueError:
        pass
    raw = b""
    mime = ""
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(
                422,
                detail={"code": "validation_error", "message": "multipart field 'file' is required", "details": []},
            )
        raw = await upload.read(5 * 1024 * 1024 + 1)
        if len(raw) > 5 * 1024 * 1024:
            raise HTTPException(
                413, detail={"code": "payload_too_large", "message": "Receipt exceeds 5 MiB", "details": []}
            )
        mime = upload.content_type or ""
    else:
        body = await request.json()
        attachment_id = body.get("attachment_id")
        if not attachment_id:
            raise HTTPException(
                422, detail={"code": "validation_error", "message": "attachment_id is required", "details": []}
            )
        try:
            record = db.scalar(
                select(Attachment).where(
                    Attachment.id == uuid_module.UUID(attachment_id),
                    Attachment.user_id == user.id,
                    Attachment.upload_status == "uploaded",
                )
            )
        except ValueError as exc:
            raise HTTPException(
                422, detail={"code": "validation_error", "message": "attachment_id must be a UUID", "details": []}
            ) from exc
        if record is None:
            raise HTTPException(
                404, detail={"code": "not_found", "message": "Attachment not found", "details": []}
            )
        raw = get_storage().get(str(record.id))
        mime = record.mime_type
    try:
        clean, mime = sanitize_image(raw, mime)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(
            422, detail={"code": "invalid_image", "message": str(exc), "details": []}
        ) from exc
    return invoke_ai(
        "parse-receipt",
        {"image_base64": base64.b64encode(clean).decode("ascii"), "mime_type": mime},
        ReceiptDraft,
        user,
        db,
    )
