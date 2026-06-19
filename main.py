import io
import tempfile
import subprocess
import json
from pathlib import Path
from typing import Literal

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    return {"status": "ok"}


PRESETS = {
    "spotify":     {"integrated_lufs": -14.0, "true_peak": -1.0, "lra_min": 6,  "lra_max": 18},
    "apple_music": {"integrated_lufs": -16.0, "true_peak": -1.0, "lra_min": 6,  "lra_max": 18},
    "youtube":     {"integrated_lufs": -14.0, "true_peak": -1.0, "lra_min": 6,  "lra_max": 18},
    "club":        {"integrated_lufs": -7.5,  "true_peak": -0.3, "lra_min": 4,  "lra_max": 10},
    "radio":       {"integrated_lufs": -23.0, "true_peak": -3.0, "lra_min": 4,  "lra_max": 15},
    "cd_master":   {"integrated_lufs": -10.5, "true_peak":  0.0, "lra_min": 6,  "lra_max": 14},
}

PresetName = Literal["spotify", "apple_music", "youtube", "club", "radio", "cd_master"]

SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac", ".aiff", ".aif", ".ogg", ".m4a"}
MAX_FILE_SIZE = 200 * 1024 * 1024  # 200 MB


def _true_peak_ffmpeg(path: str) -> float:
    cmd = [
        "ffmpeg", "-i", path,
        "-af", "loudnorm=I=-23:TP=-1:LRA=11:print_format=json",
        "-f", "null", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    combined = result.stdout + result.stderr
    start = combined.rfind("{")
    end = combined.rfind("}") + 1
    if start == -1 or end == 0:
        return 0.0
    data = json.loads(combined[start:end])
    return float(data.get("input_tp", 0.0))


def _loudnorm_two_pass(src: str, dst: str, target_i: float, target_tp: float) -> None:
    cmd1 = [
        "ffmpeg", "-i", src,
        "-af", f"loudnorm=I={target_i}:TP={target_tp}:LRA=11:print_format=json",
        "-f", "null", "-",
    ]
    r1 = subprocess.run(cmd1, capture_output=True, text=True)
    combined = r1.stdout + r1.stderr
    start = combined.rfind("{")
    end = combined.rfind("}") + 1
    data = json.loads(combined[start:end])

    measured_i      = data["input_i"]
    measured_lra    = data["input_lra"]
    measured_tp     = data["input_tp"]
    measured_thresh = data["input_thresh"]
    offset          = data["target_offset"]

    af = (
        f"loudnorm=I={target_i}:TP={target_tp}:LRA=11"
        f":measured_I={measured_i}:measured_LRA={measured_lra}"
        f":measured_TP={measured_tp}:measured_thresh={measured_thresh}"
        f":offset={offset}:linear=true:print_format=none"
    )
    cmd2 = ["ffmpeg", "-y", "-i", src, "-af", af, dst]
    subprocess.run(cmd2, check=True, capture_output=True)


def _gain_adjust(data: np.ndarray, gain_db: float) -> np.ndarray:
    return data * (10 ** (gain_db / 20))


def _rms(channel: np.ndarray) -> float:
    return float(np.sqrt(np.mean(channel ** 2)))


def _phase_correlation(data: np.ndarray) -> float:
    if data.ndim == 1:
        return 1.0
    l, r = data[:, 0], data[:, 1]
    denom = np.sqrt(np.sum(l**2) * np.sum(r**2))
    if denom == 0:
        return 0.0
    return float(np.dot(l, r) / denom)


def _short_term_lufs(meter: pyln.Meter, data: np.ndarray, rate: int) -> float:
    window = 3 * rate
    if len(data) < window:
        return meter.integrated_loudness(data)
    mid = len(data) // 2
    segment = data[mid - window // 2: mid + window // 2]
    try:
        return meter.integrated_loudness(segment)
    except Exception:
        return -70.0


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    preset: PresetName = Form(...),
):
    if preset not in PRESETS:
        raise HTTPException(status_code=400, detail=f"Preset inválido: {preset}")

    filename = file.filename or "audio"
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail="Formato não suportado. Use WAV, MP3, FLAC ou AIFF.",
        )

    raw_bytes = await file.read()
    if len(raw_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Arquivo muito grande. Limite: 200 MB.",
        )

    preset_cfg = PRESETS[preset]
    target_lufs = preset_cfg["integrated_lufs"]
    target_tp = preset_cfg["true_peak"]

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        src_path = tmp / f"original{ext}"
        wav_path = tmp / "original.wav"
        intermediate_path = tmp / "intermediate.wav"
        corrected_path = tmp / "corrected.wav"

        src_path.write_bytes(raw_bytes)

        # Convert to WAV if needed so soundfile can reliably read it
        if ext != ".wav":
            conv = subprocess.run(
                ["ffmpeg", "-y", "-i", str(src_path), str(wav_path)],
                capture_output=True,
            )
            if conv.returncode != 0:
                raise HTTPException(
                    status_code=422,
                    detail="Arquivo de áudio inválido ou corrompido.",
                )
        else:
            wav_path = src_path

        try:
            data, rate = sf.read(str(wav_path), always_2d=True)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Arquivo de áudio inválido: {e}")

        meter = pyln.Meter(rate)

        try:
            integrated = meter.integrated_loudness(data)
        except Exception:
            integrated = -70.0

        true_peak = _true_peak_ffmpeg(str(wav_path))

        # Apply corrections
        working = data.copy()
        gain_needed = target_lufs - integrated
        if abs(gain_needed) > 0.2:
            working = _gain_adjust(working, gain_needed)

        if true_peak > target_tp:
            sf.write(str(intermediate_path), working, rate)
            _loudnorm_two_pass(
                str(intermediate_path), str(corrected_path),
                target_i=target_lufs, target_tp=target_tp,
            )
            working, _ = sf.read(str(corrected_path), always_2d=True)

        sf.write(str(corrected_path), working, rate)

        wav_bytes = corrected_path.read_bytes()

    return StreamingResponse(
        io.BytesIO(wav_bytes),
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=corrected.wav"},
    )
