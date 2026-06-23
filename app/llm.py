import os
import json
from typing import AsyncIterator

import httpx

# Endpoint e modelo configuráveis. Defaults apontam para o Lovable AI Gateway
# (OpenAI-compatível). Ajuste LOVABLE_MODEL conforme o catálogo atual do gateway.
LOVABLE_API_URL = os.environ.get(
    "LOVABLE_API_URL", "https://ai.gateway.lovable.dev/v1/chat/completions"
)
LOVABLE_MODEL   = os.environ.get("LOVABLE_MODEL", "google/gemini-2.5-flash")
LLM_TIMEOUT     = float(os.environ.get("LLM_TIMEOUT", "60"))


class LLMConfigError(RuntimeError):
    pass


class LLMUpstreamError(RuntimeError):
    pass


def _api_key() -> str:
    key = os.environ.get("LOVABLE_API_KEY", "")
    if not key:
        raise LLMConfigError("LOVABLE_API_KEY não configurada")
    return key


async def stream_chat(messages: list[dict], temperature: float = 0.4) -> AsyncIterator[str]:
    """Faz POST streaming ao gateway e yfield-a os deltas de texto (content).

    `messages` deve estar no formato OpenAI: [{"role": ..., "content": ...}].
    Levanta LLMConfigError se faltar a chave e LLMUpstreamError em erro HTTP.
    """
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": LOVABLE_MODEL,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        async with client.stream("POST", LOVABLE_API_URL, headers=headers, json=payload) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                raise LLMUpstreamError(f"gateway {resp.status_code}: {body[:300].decode(errors='replace')}")

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content
