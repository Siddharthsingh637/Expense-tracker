from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from expense_tracker_api.api.v1.common import next_sync_seq
from expense_tracker_api.core.config import ATTACHMENT_DIR, ATTACHMENT_QUOTA_BYTES
from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.models import Attachment, SyncChange, Transaction, User, utcnow
from expense_tracker_api.services.storage import LocalDiskStorage, checksum, sanitize_image

router = APIRouter(prefix="/attachments", tags=["attachments"])
MAX_IMAGE = 5 * 1024 * 1024


def get_storage() -> LocalDiskStorage:
    return LocalDiskStorage(ATTACHMENT_DIR)


async def read_limited(request: Request, limit: int) -> bytes:
    pieces, size = [], 0
    async for piece in request.stream():
        size += len(piece)
        if size > limit:
            raise HTTPException(413, detail={"code":"payload_too_large", "message":"Request exceeds the allowed size", "details":[]})
        pieces.append(piece)
    return b"".join(pieces)


@router.put("/{attachment_id}")
async def put_attachment(attachment_id: uuid.UUID, request: Request,
                         transaction_id: uuid.UUID | None = Header(default=None, alias="X-Transaction-ID"),
                         checksum_header: str | None = Header(default=None, alias="X-Checksum-SHA256"),
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    declared = request.headers.get("content-type", "").split(";", 1)[0].lower()
    raw = await read_limited(request, MAX_IMAGE)
    if not checksum_header:
        raise HTTPException(400, detail={"code":"checksum_required", "message":"X-Checksum-SHA256 is required", "details":[]})
    if checksum(raw).lower() != checksum_header.strip().lower():
        raise HTTPException(400, detail={"code":"checksum_mismatch", "message":"SHA-256 checksum does not match upload", "details":[]})
    prior = db.scalar(select(Attachment).where(Attachment.id == attachment_id, Attachment.user_id == user.id))
    transaction_id = transaction_id or (prior.transaction_id if prior is not None else None)
    if transaction_id is None:
        raise HTTPException(422, detail={"code":"validation_error", "message":"X-Transaction-ID is required for a new attachment", "details":[]})
    txn = db.scalar(select(Transaction).where(Transaction.id == transaction_id, Transaction.user_id == user.id))
    if txn is None:
        raise HTTPException(404, detail={"code":"not_found", "message":"Transaction not found", "details":[]})
    try:
        clean, mime = sanitize_image(raw, declared)
    except ValueError as exc:
        raise HTTPException(422, detail={"code":"invalid_image", "message":str(exc), "details":[]}) from exc
    digest = checksum(clean)
    if prior is not None:
        if prior.upload_status == "uploaded" and prior.checksum_sha256 == digest and prior.transaction_id == transaction_id:
            return {"id":str(prior.id), "transaction_id":str(prior.transaction_id), "mime_type":prior.mime_type,
                    "size_bytes":prior.size_bytes, "checksum_sha256":prior.checksum_sha256, "upload_status":"uploaded"}
        if prior.upload_status != "pending" or prior.transaction_id != transaction_id:
            raise HTTPException(409, detail={"code":"attachment_conflict", "message":"Attachment id already contains different bytes", "details":[]})
    used = db.scalar(select(func.coalesce(func.sum(Attachment.size_bytes), 0)).where(Attachment.user_id == user.id, Attachment.deleted_at.is_(None), Attachment.upload_status == "uploaded")) or 0
    used -= prior.size_bytes if prior is not None and prior.upload_status == "uploaded" else 0
    if used + len(clean) > ATTACHMENT_QUOTA_BYTES:
        raise HTTPException(413, detail={"code":"storage_quota_exceeded", "message":"Per-user attachment quota exceeded", "details":[]})
    now = utcnow()
    if prior is None:
        row = Attachment(id=attachment_id, user_id=user.id, transaction_id=transaction_id, mime_type=mime,
                         size_bytes=len(clean), checksum_sha256=digest, upload_status="uploaded",
                         storage_key=str(attachment_id), created_at=now, updated_at=now, deleted_at=None,
                         sync_seq=next_sync_seq(db, user.id))
    else:
        row = prior
        row.mime_type, row.size_bytes, row.checksum_sha256 = mime, len(clean), digest
        row.upload_status, row.storage_key, row.updated_at = "uploaded", str(attachment_id), now
        row.sync_seq = next_sync_seq(db, user.id)
    get_storage().put(str(attachment_id), clean)
    db.add(row)
    db.add(SyncChange(user_id=user.id, sync_seq=row.sync_seq, resource="attachment", record_id=str(row.id),
                      operation="upsert", snapshot={"id":str(row.id), "transaction_id":str(row.transaction_id),
                      "mime_type":mime, "size_bytes":len(clean), "checksum_sha256":digest,
                      "upload_status":"uploaded", "created_at":now.isoformat().replace("+00:00","Z"),
                      "updated_at":now.isoformat().replace("+00:00","Z"), "deleted_at":None}, created_at=now))
    try:
        db.commit()
    except Exception:
        db.rollback()
        get_storage().delete(str(attachment_id))
        raise
    return {"id":str(row.id), "transaction_id":str(row.transaction_id), "mime_type":mime,
            "size_bytes":row.size_bytes, "checksum_sha256":digest, "upload_status":"uploaded"}


@router.get("/{attachment_id}")
def get_attachment(attachment_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(Attachment).where(Attachment.id == attachment_id, Attachment.user_id == user.id,
                                          Attachment.deleted_at.is_(None), Attachment.upload_status == "uploaded"))
    if row is None:
        raise HTTPException(404, detail={"code":"not_found", "message":"Attachment not found", "details":[]})
    try:
        content = get_storage().get(str(row.id))
    except FileNotFoundError as exc:
        raise HTTPException(404, detail={"code":"attachment_missing", "message":"Receipt bytes are unavailable", "details":[]}) from exc
    return Response(content, media_type=row.mime_type, headers={"Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff"})
