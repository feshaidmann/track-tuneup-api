import os
from fastapi import APIRouter, Header, HTTPException

from app.storage import cleanup_expired_objects

router = APIRouter(prefix="/api/internal", tags=["internal"])

INTERNAL_KEY = os.environ.get("INTERNAL_API_KEY", "")


def _require_internal(x_internal_key: str | None) -> None:
    if not INTERNAL_KEY or x_internal_key != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.post("/cleanup")
async def cleanup(x_internal_key: str | None = Header(default=None)):
    _require_internal(x_internal_key)
    deleted = cleanup_expired_objects()
    return {"deleted": deleted}
