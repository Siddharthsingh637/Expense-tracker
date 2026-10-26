from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy.orm import Session

from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.features.attachments.service import (
    get_attachment_service,
    put_attachment_service,
)
from expense_tracker_api.models import User

router = APIRouter(prefix="/attachments", tags=["attachments"])


@router.put("/{attachment_id}")
async def put_attachment(
    attachment_id: uuid.UUID,
    request: Request,
    transaction_id: uuid.UUID | None = Header(default=None, alias="X-Transaction-ID"),
    checksum_header: str | None = Header(default=None, alias="X-Checksum-SHA256"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await put_attachment_service(
        attachment_id, request, transaction_id, checksum_header, user, db
    )


@router.get("/{attachment_id}")
def get_attachment(
    attachment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    return get_attachment_service(attachment_id, user, db)
