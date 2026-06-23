import os
import logging
import tempfile
import subprocess
import json
import shutil
import functools
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask

from app.routers import storage as storage_router
from app.routers import events  as events_router
from app.routers import admin   as admin_router
from app.routers import internal as internal_router

logger = logging.getLogger("track-tuneup")

# --- Limites de hardening (configuráveis por env, com defaults seguros) ---
# Origem(ns) permitida(s) no CORS — só o frontend publicado, não "*".
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "https://track-tuneup.lovable.app").split(",")
    if o.strip()
]
# Teto de upload no servidor (o frontend já limita a 200 MB; aqui é a defesa real).
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "200")) * 1024 * 1024
# Timeout de cada chamada ao ffmpeg, para um arquivo patológico não prender o worker.
FFMPEG_TIMEOUT = int(os.environ.get("FFMPEG_TIMEOUT", "120"))
# Extensões de áudio aceitas (mesmo conjunto do frontend).
ALLOWED_EXTS = {".wav", ".mp3", ".flac", ".aiff", ".aif"}

app = FastAPI()

app.include_router(storage_router.router)
app.include_router(events_router.router)
app.include_router(admin_router.router)
app.include_router(internal_router.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

PRESETS = {
    "spotify":     {"integrated_lufs": -14.0, "true_peak": -1.0, "target_lra": 11},
    "apple_music": {"integrated_lufs": -16.0, "true_peak": -1.0, "target_lra": 11},
    "youtube":     {"integrated_lufs": -14.0, "true_peak": -1.0, "target_lra": 11},
    "club":        {"integrated_lufs":  -7.5, "true_peak": -0.3, "target_lra":  7},
    "radio":       {"integrated_lufs": -23.0, "true_peak": -3.0, "target_lra":  8},
    "cd_master":   {"integrated_lufs": -10.5, "true_peak":  0.0, "target_lra": 11},
}


@app.get("/")
def health_check():
    return {"status": "ok"}


def _loudnorm_measure(src: str, target_i: float, target_tp: float, target_lra: float) -> dict:
    cmd = [
        "ffmpeg", "-i", src,
        "-af", f"loudnorm=I={target_i}:TP={target_tp}:LRA={target_lra}:print_format=json",
        "-f", "null", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    combined = result.stdout + result.stderr
    start = combined.rfind("{")
    end = combined.rfind("}") + 1
    if start == -1 or end == 0:
        raise RuntimeError("Falha ao medir loudness no Pass 1")
    return json.loads(combined[start:end])


# loudnorm aceita measured_I/measured_TP em [-99, 0] e measured_thresh em [-99, 0].
# Faixas com clipping severo medem acima de 0 e quebram o modo two-pass linear.
def _measured_in_range(measured: dict) -> bool:
    try:
        return (
            -99.0 <= float(measured["input_i"]) <= 0.0
            and -99.0 <= float(measured["input_tp"]) <= 0.0
            and -99.0 <= float(measured["input_thresh"]) <= 0.0
        )
    except (KeyError, ValueError, TypeError):
        return False


def _loudnorm_apply(src: str, dst: str, target_i: float, target_tp: float, target_lra: float, measured: dict) -> None:
    if _measured_in_range(measured):
        # Two-pass: linear quando a dinâmica medida cabe no alvo, dynamic caso contrário.
        measured_lra = float(measured["input_lra"])
        use_linear = "true" if measured_lra <= target_lra else "false"
        af = (
            f"loudnorm=I={target_i}:TP={target_tp}:LRA={target_lra}"
            f":measured_I={measured['input_i']}"
            f":measured_LRA={measured['input_lra']}"
            f":measured_TP={measured['input_tp']}"
            f":measured_thresh={measured['input_thresh']}"
            f":offset={measured['target_offset']}"
            f":linear={use_linear}"
            f":print_format=none"
        )
    else:
        # Fallback dinâmico (single-pass): aceita qualquer entrada, inclusive
        # faixas clipando acima de 0 LUFS que o two-pass rejeitaria.
        af = f"loudnorm=I={target_i}:TP={target_tp}:LRA={target_lra}:print_format=none"

    cmd = ["ffmpeg", "-y", "-i", src, "-af", af, "-ar", "44100", "-c:a", "pcm_s24le", dst]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    if result.returncode != 0:
        raise RuntimeError(f"Falha no Pass 2: {result.stderr[-500:]}")


@functools.lru_cache(maxsize=1)
def _alimiter_has_oversample() -> bool:
    # A opção oversample do alimiter só existe em builds mais recentes do ffmpeg.
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-h", "filter=alimiter"],
            capture_output=True, text=True, timeout=15,
        )
        return "oversample" in (out.stdout + out.stderr)
    except Exception:
        return False


def _true_peak_limit(src: str, dst: str, ceiling_db: float) -> None:
    # Estágio final: limiter dedicado de true peak para capturar inter-sample
    # peaks residuais que o loudnorm possa deixar passar.
    # alimiter usa limit em escala linear, não dB: linear = 10^(dB/20).
    # limit válido em [0.0625, 1]; ceiling 0 dB -> 1.0 (sem teto extra).
    limit_linear = min(1.0, max(0.0625, 10 ** (ceiling_db / 20)))
    # level=false: não auto-normaliza o nível, só limita picos.
    limiter = f"alimiter=limit={limit_linear:.6f}:level=false:asc=1"

    if _alimiter_has_oversample():
        # Caminho ideal: oversampling 4x nativo, sem reamostragem extra.
        af = f"{limiter}:oversample=4"
    else:
        # Fallback portável: limita no domínio 4x superamostrado e reamostra de
        # volta, aproximando o controle de inter-sample peaks em qualquer versão.
        af = f"aresample=176400,{limiter},aresample=44100"

    cmd = ["ffmpeg", "-y", "-i", src, "-af", af, "-ar", "44100", "-c:a", "pcm_s24le", dst]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    if result.returncode != 0:
        raise RuntimeError(f"Falha no true peak limiter: {result.stderr[-500:]}")


@app.post("/analyze")
async def analyze(file: UploadFile = File(...), preset: str = Form(...)):
    if preset not in PRESETS:
        return JSONResponse(status_code=400, content={"error": "Preset inválido"})

    # Validação de tipo: rejeita antes de gastar CPU com ffmpeg.
    ext = Path(file.filename or "audio.wav").suffix.lower() or ".wav"
    if ext not in ALLOWED_EXTS:
        return JSONResponse(status_code=415, content={"error": "Formato não suportado"})

    cfg = PRESETS[preset]
    target_i, target_tp, target_lra = cfg["integrated_lufs"], cfg["true_peak"], cfg["target_lra"]

    tmpdir = tempfile.mkdtemp()
    try:
        src_path = Path(tmpdir) / f"original{ext}"
        loudnorm_path = Path(tmpdir) / "loudnorm.wav"
        corrected_path = Path(tmpdir) / "corrected.wav"

        # Grava em streaming com teto de tamanho: não carrega o arquivo inteiro em
        # memória e aborta cedo se passar do limite (defesa contra exaustão/DoS).
        size = 0
        with open(src_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    shutil.rmtree(tmpdir, ignore_errors=True)
                    return JSONResponse(status_code=413, content={"error": "Arquivo muito grande"})
                out.write(chunk)

        if size == 0:
            shutil.rmtree(tmpdir, ignore_errors=True)
            return JSONResponse(status_code=400, content={"error": "Arquivo vazio"})

        # Estágio 1+2: loudnorm two-pass (equilibra loudness e true peak).
        measured = _loudnorm_measure(str(src_path), target_i, target_tp, target_lra)
        _loudnorm_apply(str(src_path), str(loudnorm_path), target_i, target_tp, target_lra, measured)

        if not loudnorm_path.exists() or loudnorm_path.stat().st_size == 0:
            raise RuntimeError("Arquivo corrigido não foi gerado")

        # Estágio 3: true peak limiter dedicado, garantindo o ceiling do preset.
        _true_peak_limit(str(loudnorm_path), str(corrected_path), target_tp)

        if not corrected_path.exists() or corrected_path.stat().st_size == 0:
            raise RuntimeError("Arquivo corrigido não foi gerado")

        return FileResponse(
            str(corrected_path),
            media_type="audio/wav",
            filename="corrected.wav",
            background=BackgroundTask(shutil.rmtree, tmpdir, ignore_errors=True),
        )
    except subprocess.TimeoutExpired:
        logger.exception("Timeout do ffmpeg no /analyze")
        shutil.rmtree(tmpdir, ignore_errors=True)
        return JSONResponse(status_code=504, content={"error": "Tempo de processamento excedido"})
    except Exception:
        # Loga o detalhe internamente, mas devolve mensagem genérica (não vaza
        # stderr do ffmpeg / caminhos internos para o cliente).
        logger.exception("Falha no /analyze")
        shutil.rmtree(tmpdir, ignore_errors=True)
        return JSONResponse(status_code=500, content={"error": "Falha ao processar o áudio"})
