from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.validators import UploadUrlRequest
from app.storage import generate_upload_path, create_upload_url, register_object
from app.throttle import ensure_client_exists

router = APIRouter(prefix="/api/storage", tags=["storage"])


@router.post("/upload-url")
async def get_upload_url(body: UploadUrlRequest):
    ensure_client_exists(body.client_id)
    path = generate_upload_path(body.client_id, body.filename)
    signed_url = create_upload_url(body.bucket, path)
    register_object(
        client_id=body.client_id,
        bucket=body.bucket,
        path=path,
        content_type=None,
    )
    return {"upload_url": signed_url, "path": path, "bucket": body.bucket}
