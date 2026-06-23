import os
from fastapi import APIRouter, Header, HTTPException

from app.supabase_client import get_client

router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN_KEY = os.environ.get("ADMIN_API_KEY", "")


def _require_admin(x_admin_key: str | None) -> None:
    if not ADMIN_KEY or x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.get("/stats")
async def stats(x_admin_key: str | None = Header(default=None)):
    _require_admin(x_admin_key)
    sb = get_client()

    clients_res  = sb.table("tuneup_clients").select("id",  count="exact").execute()
    analyses_res = sb.table("tuneup_analyses").select("id", count="exact").execute()
    events_res   = sb.table("tuneup_events").select("id",   count="exact").execute()

    done_res  = (
        sb.table("tuneup_analyses")
        .select("id", count="exact")
        .eq("status", "done")
        .execute()
    )
    error_res = (
        sb.table("tuneup_analyses")
        .select("id", count="exact")
        .eq("status", "error")
        .execute()
    )

    # Top presets
    preset_res = sb.table("tuneup_analyses").select("preset").execute()
    preset_counts: dict[str, int] = {}
    for row in (preset_res.data or []):
        p = row["preset"]
        preset_counts[p] = preset_counts.get(p, 0) + 1
    top_presets = sorted(preset_counts.items(), key=lambda x: x[1], reverse=True)

    return {
        "clients":   clients_res.count,
        "analyses":  analyses_res.count,
        "done":      done_res.count,
        "errors":    error_res.count,
        "events":    events_res.count,
        "top_presets": [{"preset": p, "count": c} for p, c in top_presets[:6]],
    }
