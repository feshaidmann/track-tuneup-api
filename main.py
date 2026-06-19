import tempfile
import subprocess
import json
import shutil
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
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
    result = subprocess.run(cmd, capture_output=True, text=True)
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
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Falha no Pass 2: {result.stderr[-500:]}")


@app.post("/analyze")
async def analyze(file: UploadFile = File(...), preset: str = Form(...)):
    if preset not in PRESETS:
        return JSONResponse(status_code=400, content={"error": "Preset inválido"})

    cfg = PRESETS[preset]
    target_i, target_tp, target_lra = cfg["integrated_lufs"], cfg["true_peak"], cfg["target_lra"]

    tmpdir = tempfile.mkdtemp()
    try:
        ext = Path(file.filename or "audio.wav").suffix or ".wav"
        src_path = Path(tmpdir) / f"original{ext}"
        corrected_path = Path(tmpdir) / "corrected.wav"

        content = await file.read()
        src_path.write_bytes(content)

        measured = _loudnorm_measure(str(src_path), target_i, target_tp, target_lra)
        _loudnorm_apply(str(src_path), str(corrected_path), target_i, target_tp, target_lra, measured)

        if not corrected_path.exists() or corrected_path.stat().st_size == 0:
            raise RuntimeError("Arquivo corrigido não foi gerado")

        return FileResponse(
            str(corrected_path),
            media_type="audio/wav",
            filename="corrected.wav",
            background=BackgroundTask(shutil.rmtree, tmpdir, ignore_errors=True),
        )
    except Exception as e:
        shutil.rmtree(tmpdir, ignore_errors=True)
        return JSONResponse(status_code=500, content={"error": str(e)})
