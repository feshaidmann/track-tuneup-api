from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.validators import EventPayload
from app.supabase_client import get_client
from app.throttle import ensure_client_exists

router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("")
async def record_event(body: EventPayload):
    ensure_client_exists(body.client_id)
    sb = get_client()
    row = {
        "client_id":   body.client_id,
        "event_type":  body.event_type,
        "analysis_id": body.analysis_id,
        "payload":     body.payload,
    }
    sb.table("tuneup_events").insert(row).execute()
    return {"ok": True}
