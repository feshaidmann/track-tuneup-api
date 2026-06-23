from datetime import datetime, timezone

from app.supabase_client import get_client

# Limite de mensagens guardadas por conversa, p/ não inchar o jsonb.
MAX_STORED_MESSAGES = 40


def save_conversation(
    client_id: str,
    messages: list[dict],
    analysis_id: str | None = None,
) -> None:
    """Persiste o snapshot da conversa. Best-effort: uma conversa por análise
    (quando há analysis_id) ou por cliente. Falhas aqui não devem derrubar o chat."""
    sb = get_client()
    trimmed = messages[-MAX_STORED_MESSAGES:]
    now = datetime.now(timezone.utc).isoformat()

    query = sb.table("tuneup_chat_conversations").select("id")
    query = query.eq("analysis_id", analysis_id) if analysis_id else query.eq("client_id", client_id).is_("analysis_id", "null")
    existing = query.order("created_at", desc=True).limit(1).execute()

    if existing.data:
        conv_id = existing.data[0]["id"]
        sb.table("tuneup_chat_conversations").update(
            {"messages": trimmed, "updated_at": now}
        ).eq("id", conv_id).execute()
    else:
        sb.table("tuneup_chat_conversations").insert(
            {
                "client_id":   client_id,
                "analysis_id": analysis_id,
                "messages":    trimmed,
                "updated_at":  now,
            }
        ).execute()
