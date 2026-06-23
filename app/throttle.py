import os
from datetime import datetime, timezone, timedelta

from app.supabase_client import get_client

# Limite de análises por cliente por janela de tempo.
ANALYSIS_LIMIT = 10
WINDOW_HOURS   = 24

# Limite de turnos de chat por hora (o chat chama um gateway pago).
CHAT_RATE_LIMIT = int(os.environ.get("CHAT_RATE_LIMIT", "40"))


def count_recent_analyses(client_id: str) -> int:
    sb = get_client()
    since = (datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)).isoformat()
    res = (
        sb.table("tuneup_analyses")
        .select("id", count="exact")
        .eq("client_id", client_id)
        .gte("created_at", since)
        .execute()
    )
    return res.count or 0


def is_throttled(client_id: str) -> bool:
    return count_recent_analyses(client_id) >= ANALYSIS_LIMIT


def count_recent_events(client_id: str, event_type: str, hours: int = 1) -> int:
    sb = get_client()
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    res = (
        sb.table("tuneup_events")
        .select("id", count="exact")
        .eq("client_id", client_id)
        .eq("event_type", event_type)
        .gte("created_at", since)
        .execute()
    )
    return res.count or 0


def is_chat_throttled(client_id: str) -> bool:
    return count_recent_events(client_id, "chat_turn", hours=1) >= CHAT_RATE_LIMIT


def ensure_client_exists(client_id: str) -> None:
    # Upsert idempotente: evita a corrida (TOCTOU) de select+insert, que dois
    # requests concorrentes do mesmo client_id transformariam em erro de PK.
    sb = get_client()
    sb.table("tuneup_clients").upsert({"id": client_id}, ignore_duplicates=True).execute()
