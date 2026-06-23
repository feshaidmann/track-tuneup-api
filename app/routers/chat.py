import json
import asyncio
import logging
import functools
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse, JSONResponse

from app.validators import ChatRequest
from app.llm import stream_chat, LLMConfigError, LLMUpstreamError
from app.throttle import ensure_client_exists, is_chat_throttled
from app.supabase_client import get_client
from app.chat_store import save_conversation

logger = logging.getLogger("track-tuneup.chat")
router = APIRouter(prefix="/api/chat", tags=["chat"])

_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "consultor.md"

# Rótulos legíveis das métricas, na ordem em que fazem sentido no contexto.
_METRIC_LABELS = [
    ("integrated_lufs",  "LUFS integrado", "LUFS"),
    ("short_term_lufs",  "LUFS curto prazo", "LUFS"),
    ("true_peak",        "True peak", "dBTP"),
    ("dynamic_range",    "Faixa dinâmica", "dB"),
    ("loudness_range",   "LRA", "LU"),
    ("lr_balance",       "Balanço L/R", "%"),
    ("phase_correlation","Correlação de fase", ""),
]


@functools.lru_cache(maxsize=1)
def _load_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _fmt(v) -> str:
    return f"{v:.1f}" if isinstance(v, (int, float)) else "—"


def _context_block(preset: str, before: dict | None, after: dict | None) -> str:
    lines = [f"Preset/destino escolhido: **{preset}**"]
    if before or after:
        lines.append("\nMétricas (antes → depois):")
        b, a = before or {}, after or {}
        for key, label, unit in _METRIC_LABELS:
            if key not in b and key not in a:
                continue
            suffix = f" {unit}" if unit else ""
            lines.append(f"- {label}: {_fmt(b.get(key))}{suffix} → {_fmt(a.get(key))}{suffix}")
    else:
        lines.append("\n(Sem métricas disponíveis nesta conversa.)")
    return "\n".join(lines)


@router.post("")
async def chat(req: ChatRequest):
    await asyncio.to_thread(ensure_client_exists, req.client_id)

    if await asyncio.to_thread(is_chat_throttled, req.client_id):
        return JSONResponse(
            status_code=429,
            content={"error": "Muitas mensagens em pouco tempo. Tente novamente mais tarde."},
        )

    system = _load_prompt() + "\n\n## Contexto desta análise\n" + _context_block(
        req.preset, req.metrics_before, req.metrics_after
    )
    history = [{"role": m.role, "content": m.content} for m in req.messages]
    llm_messages = [{"role": "system", "content": system}, *history]

    async def event_stream() -> AsyncIterator[str]:
        assistant_parts: list[str] = []
        try:
            async for delta in stream_chat(llm_messages):
                assistant_parts.append(delta)
                yield f"data: {json.dumps({'delta': delta})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except LLMConfigError:
            logger.exception("Chat sem configuração do gateway")
            yield f"data: {json.dumps({'error': 'Serviço de chat indisponível.'})}\n\n"
            return
        except LLMUpstreamError:
            logger.exception("Erro do gateway no chat")
            yield f"data: {json.dumps({'error': 'Falha ao falar com o assistente.'})}\n\n"
            return
        except Exception:
            logger.exception("Erro inesperado no chat")
            yield f"data: {json.dumps({'error': 'Erro inesperado.'})}\n\n"
            return

        # Persistência + telemetria após o stream — best-effort, fora do loop quente.
        reply = "".join(assistant_parts)
        if reply:
            full = [*history, {"role": "assistant", "content": reply}]
            try:
                await asyncio.to_thread(save_conversation, req.client_id, full, req.analysis_id)
                await asyncio.to_thread(_record_chat_turn, req.client_id, req.analysis_id)
            except Exception:
                logger.exception("Falha ao persistir conversa (ignorada)")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _record_chat_turn(client_id: str, analysis_id: str | None) -> None:
    sb = get_client()
    sb.table("tuneup_events").insert(
        {"client_id": client_id, "analysis_id": analysis_id, "event_type": "chat_turn", "payload": {}}
    ).execute()
