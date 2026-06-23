import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, AfterValidator

# Buckets em que o cliente anônimo pode pedir URL de upload. Arquivos corrigidos
# são produzidos pelo servidor, então o cliente não escreve em "audio-corrected".
ALLOWED_UPLOAD_BUCKETS = {"audio-uploads"}


def _require_uuid(v: str) -> str:
    try:
        uuid.UUID(str(v))
    except (ValueError, TypeError):
        raise ValueError("must be a valid UUID")
    return v


def _optional_uuid(v: str | None) -> str | None:
    return None if v is None else _require_uuid(v)


def _validate_bucket(v: str) -> str:
    if v not in ALLOWED_UPLOAD_BUCKETS:
        raise ValueError("invalid bucket")
    return v


ClientId     = Annotated[str, AfterValidator(_require_uuid)]
AnalysisId   = Annotated[str | None, AfterValidator(_optional_uuid)]
UploadBucket = Annotated[str, AfterValidator(_validate_bucket)]


class UploadUrlRequest(BaseModel):
    client_id: ClientId
    filename:  str          = Field(..., min_length=1, max_length=255)
    bucket:    UploadBucket = "audio-uploads"


class EventPayload(BaseModel):
    client_id:   ClientId
    event_type:  str            = Field(..., min_length=1, max_length=64)
    analysis_id: AnalysisId     = None
    payload:     dict[str, Any] = Field(default_factory=dict)


class MixRequestPayload(BaseModel):
    client_id:   ClientId
    analysis_id: AnalysisId  = None
    contact:     str | None  = Field(default=None, max_length=320)
    notes:       str | None  = Field(default=None, max_length=2000)


# Só aceitamos user/assistant do cliente; o system prompt é sempre injetado
# pelo servidor, nunca vindo do front (evita prompt injection via histórico).
class ChatMessage(BaseModel):
    role:    Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    client_id:      ClientId
    analysis_id:    AnalysisId           = None
    preset:         str                  = Field(..., min_length=1, max_length=32)
    messages:       list[ChatMessage]    = Field(..., min_length=1, max_length=30)
    metrics_before: dict[str, Any] | None = None
    metrics_after:  dict[str, Any] | None = None
