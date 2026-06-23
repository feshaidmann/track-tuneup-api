from datetime import datetime, timezone, timedelta

from app.supabase_client import get_client

# Limite de análises por cliente por janela de tempo.
ANALYSIS_LIMIT = 10
WINDOW_HOURS   = 24


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


def ensure_client_exists(client_id: str) -> None:
    # Upsert idempotente: evita a corrida (TOCTOU) de select+insert, que dois
    # requests concorrentes do mesmo client_id transformariam em erro de PK.
    sb = get_client()
    sb.table("tuneup_clients").upsert({"id": client_id}, ignore_duplicates=True).execute()
