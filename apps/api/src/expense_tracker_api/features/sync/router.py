from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from expense_tracker_api.core.config import MAX_SYNC_PULL_LIMIT
from expense_tracker_api.core.dependencies import get_current_user, get_db
from expense_tracker_api.features.sync.service import sync_pull_service, sync_push_service
from expense_tracker_api.models import User
from expense_tracker_api.schemas_v2 import SyncPushV2

router = APIRouter(tags=["sync"])


@router.post("/sync/push")
async def sync_push(
    payload: SyncPushV2,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await sync_push_service(payload, request, user, db)


@router.get("/sync/pull")
def sync_pull(
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=MAX_SYNC_PULL_LIMIT),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return sync_pull_service(cursor, limit, user, db)
