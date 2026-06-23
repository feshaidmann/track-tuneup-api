import uuid
from datetime import datetime, timezone, timedelta

from app.supabase_client import get_client

UPLOAD_EXPIRES_SECONDS = 3600        # URL de upload válida por 1 h
DOWNLOAD_EXPIRES_SECONDS = 86400 * 7 # URL de download válida por 7 dias


def generate_upload_path(client_id: str, filename: str) -> str:
    safe_name = filename.replace("/", "_").replace("..", "_")
    return f"{client_id}/{uuid.uuid4()}_{safe_name}"


def create_upload_url(bucket: str, path: str) -> str:
    sb = get_client()
    # create_signed_upload_url retorna {signed_url, signedUrl, token, path}
    # (não tem "signedURL"); create_signed_url retorna {signedURL, signedUrl}.
    # "signedUrl" é a única chave comum aos dois, então usamos ela em ambos.
    res = sb.storage.from_(bucket).create_signed_upload_url(path)
    return res["signedUrl"]


def create_download_url(bucket: str, path: str, expires: int = DOWNLOAD_EXPIRES_SECONDS) -> str:
    sb = get_client()
    res = sb.storage.from_(bucket).create_signed_url(path, expires)
    return res["signedUrl"]


def delete_object(bucket: str, path: str) -> None:
    sb = get_client()
    sb.storage.from_(bucket).remove([path])


def register_object(
    client_id: str,
    bucket: str,
    path: str,
    size_bytes: int | None = None,
    content_type: str | None = None,
    analysis_id: str | None = None,
    ttl_days: int | None = 7,
) -> dict:
    sb = get_client()
    expires_at = (
        (datetime.now(timezone.utc) + timedelta(days=ttl_days)).isoformat()
        if ttl_days
        else None
    )
    row = {
        "client_id":    client_id,
        "bucket":       bucket,
        "path":         path,
        "size_bytes":   size_bytes,
        "content_type": content_type,
        "analysis_id":  analysis_id,
        "expires_at":   expires_at,
    }
    res = sb.table("tuneup_storage_objects").insert(row).execute()
    return res.data[0]


def cleanup_expired_objects() -> int:
    sb = get_client()
    now = datetime.now(timezone.utc).isoformat()
    expired = (
        sb.table("tuneup_storage_objects")
        .select("id,bucket,path")
        .lt("expires_at", now)
        .execute()
    )
    rows = expired.data or []
    deleted = 0
    for row in rows:
        try:
            delete_object(row["bucket"], row["path"])
            sb.table("tuneup_storage_objects").delete().eq("id", row["id"]).execute()
            deleted += 1
        except Exception:
            pass
    return deleted
