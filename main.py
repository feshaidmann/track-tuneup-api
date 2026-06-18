import tempfile
import subprocess
import json
from pathlib import Path
from typing import Literal

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

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


class AnalyzeRequest(BaseModel):
    file_url: str
    preset: PresetName
    corrected_upload_url: str
    corrected_path: str


class Metric(BaseModel):
    group: Literal["loudness", "peaks", "dynamics", "stereo"]
    name: str
    metric: str
    value: float
    target: float
    unit: str
    status: Literal["ok", "warning", "critical"]
    corrected: bool
    message: str


class AnalyzeResponse(BaseModel):
    summary: str
    summary_status: Literal["ok", "warning", "critical"]
    metrics: list[Metric]


def _download(url: str, dest: Path) -> None:
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    dest.write_bytes(r.content)


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

    measured_i     = data["input_i"]
    measured_lra   = data["input_lra"]
    measured_tp    = data["input_tp"]
    measured_thresh = data["input_thresh"]
    offset         = data["target_offset"]

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


def _build_metric(
    group, name, metric_key, value, target, unit, status, corrected, message
) -> Metric:
    return Metric(
        group=group,
        name=name,
        metric=metric_key,
        value=round(value, 2),
        target=round(target, 2),
        unit=unit,
        status=status,
        corrected=corrected,
        message=message,
    )


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    preset = PRESETS[req.preset]
    preset_label = req.preset.replace("_", " ").title()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        src_path = tmp / "original.wav"
        corrected_path = tmp / "corrected.wav"
        intermediate_path = tmp / "intermediate.wav"

        # 1. Download original file
        try:
            _download(req.file_url, src_path)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Falha ao baixar arquivo: {e}")

        # 2. Load audio
        try:
            data, rate = sf.read(str(src_path), always_2d=True)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Arquivo de áudio inválido: {e}")

        meter = pyln.Meter(rate)
        metrics: list[Metric] = []

        # --- Loudness ---
        try:
            integrated = meter.integrated_loudness(data)
        except Exception:
            integrated = -70.0

        st_lufs = _short_term_lufs(meter, data, rate)

        try:
            lra = pyln.LoudnessRangeFilter(rate).measure(data)
        except Exception:
            lra = 0.0

        # --- Peaks ---
        sample_peak_linear = float(np.max(np.abs(data)))
        sample_peak_db = 20 * np.log10(sample_peak_linear) if sample_peak_linear > 0 else -120.0

        true_peak = _true_peak_ffmpeg(str(src_path))

        # --- Dynamics ---
        dynamic_range = sample_peak_db - integrated if integrated > -70 else 0.0

        # --- Stereo ---
        if data.shape[1] >= 2:
            rms_l = _rms(data[:, 0])
            rms_r = _rms(data[:, 1])
            denom = max(rms_l, rms_r)
            lr_balance = float(abs(rms_l - rms_r) / denom * 100) if denom > 0 else 0.0
            phase_corr = _phase_correlation(data)
        else:
            lr_balance = 0.0
            phase_corr = 1.0

        # ================================================================
        # Corrections — only LUFS normalization and True Peak limiting
        # ================================================================
        working = data.copy()
        current_lufs = integrated
        corrected_flags: dict[str, bool] = {}

        target_lufs = preset["integrated_lufs"]
        target_tp = preset["true_peak"]

        # LUFS normalization via gain
        gain_needed = target_lufs - current_lufs
        if abs(gain_needed) > 0.2:
            working = _gain_adjust(working, gain_needed)
            current_lufs = target_lufs
            corrected_flags["integrated_lufs"] = True

        # True Peak limiting — two-pass loudnorm via ffmpeg
        if true_peak > target_tp:
            sf.write(str(intermediate_path), working, rate)
            _loudnorm_two_pass(
                str(intermediate_path), str(corrected_path),
                target_i=target_lufs, target_tp=target_tp,
            )
            working, _ = sf.read(str(corrected_path), always_2d=True)
            corrected_flags["true_peak"] = True

        # Write final corrected WAV
        sf.write(str(corrected_path), working, rate)

        # 4. Upload corrected file via signed PUT URL
        try:
            wav_bytes = corrected_path.read_bytes()
            put_resp = requests.put(
                req.corrected_upload_url,
                data=wav_bytes,
                headers={"Content-Type": "audio/wav"},
                timeout=120,
            )
            put_resp.raise_for_status()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Falha ao enviar arquivo corrigido: {e}")

        # ================================================================
        # Build metrics (order: loudness, peaks, dynamics, stereo)
        # ================================================================

        # integrated_lufs
        diff_lufs = abs(integrated - target_lufs)
        if diff_lufs <= 1.0:
            lufs_status = "ok"
        elif diff_lufs <= 3.0:
            lufs_status = "warning"
        else:
            lufs_status = "critical"
        lufs_corrected = corrected_flags.get("integrated_lufs", False)
        direction = "acima" if integrated > target_lufs else "abaixo"
        if lufs_status == "ok":
            lufs_msg = f"Seu volume está dentro do ideal para {preset_label}."
        elif lufs_corrected:
            lufs_msg = (
                f"Seu volume estava {diff_lufs:.1f} LUFS {direction} do ideal para {preset_label}. "
                f"Ajustamos na versão corrigida."
            )
        else:
            lufs_msg = (
                f"Seu volume está {diff_lufs:.1f} LUFS {direction} do ideal para {preset_label}. "
                f"Recomendamos ajustar na DAW."
            )
        metrics.append(_build_metric("loudness", "Volume integrado", "integrated_lufs",
                                     integrated, target_lufs, "LUFS", lufs_status, lufs_corrected, lufs_msg))

        # short_term_lufs — always ok (informative)
        metrics.append(_build_metric("loudness", "Volume de curto prazo", "short_term_lufs",
                                     st_lufs, target_lufs, "LUFS", "ok", False,
                                     "Medição informativa do volume no trecho central da faixa."))

        # true_peak
        tp_corrected = corrected_flags.get("true_peak", False)
        tp_status = "critical" if true_peak > target_tp else "ok"
        if tp_status == "critical" and tp_corrected:
            tp_msg = (
                f"Sua faixa tinha picos acima do limite seguro. "
                f"Isso causa distorção no streaming. Limitamos para {target_tp} dBTP."
            )
        elif tp_status == "critical":
            tp_msg = (
                f"Sua faixa tem picos acima do limite seguro ({target_tp} dBTP). "
                f"Isso pode causar distorção nas plataformas de streaming."
            )
        else:
            tp_msg = "Picos dentro do limite seguro para streaming."
        metrics.append(_build_metric("peaks", "Pico verdadeiro", "true_peak",
                                     true_peak, target_tp, "dBTP", tp_status, tp_corrected, tp_msg))

        # sample_peak
        sp_status = "warning" if sample_peak_db > -0.5 else "ok"
        sp_msg = (
            "O pico de amostra está muito próximo do limite máximo — risco de distorção digital."
            if sp_status == "warning"
            else "Nível de pico de amostra seguro."
        )
        metrics.append(_build_metric("peaks", "Pico de amostra", "sample_peak",
                                     sample_peak_db, -0.5, "dBFS", sp_status, False, sp_msg))

        # dynamic_range
        if dynamic_range >= 8.0:
            dr_status = "ok"
        elif dynamic_range >= 4.0:
            dr_status = "warning"
        else:
            dr_status = "critical"
        dr_msg = {
            "ok":       "Faixa dinâmica adequada — boa variação entre partes suaves e intensas.",
            "warning":  "Sua faixa está muito comprimida. Pouca variação de volume pode cansar o ouvinte.",
            "critical": "Sua faixa está extremamente comprimida. A diferença entre os momentos mais altos e mais baixos é mínima — isso soa cansativo e sem vida.",
        }[dr_status]
        metrics.append(_build_metric("dynamics", "Faixa dinâmica", "dynamic_range",
                                     dynamic_range, 9.0, "dB", dr_status, False, dr_msg))

        # loudness_range
        lra_min, lra_max = preset["lra_min"], preset["lra_max"]
        lra_status = "warning" if (lra < lra_min or lra > lra_max) else "ok"
        lra_msg = (
            f"A variação de loudness ({lra:.1f} LU) está fora do intervalo ideal ({lra_min}–{lra_max} LU) para {preset_label}."
            if lra_status == "warning"
            else f"Variação de loudness dentro do ideal para {preset_label}."
        )
        metrics.append(_build_metric("dynamics", "Variação de loudness", "loudness_range",
                                     lra, float(lra_min + lra_max) / 2, "LU", lra_status, False, lra_msg))

        # lr_balance
        if lr_balance <= 1.0:
            lr_status = "ok"
        elif lr_balance <= 3.0:
            lr_status = "warning"
        else:
            lr_status = "critical"
        if lr_status in ("warning", "critical"):
            side = "direito" if rms_r > rms_l else "esquerdo"
            lr_msg = (
                f"O canal {side} está {lr_balance:.1f}% mais alto que o outro. "
                f"Recomendamos corrigir na DAW."
            )
        else:
            lr_msg = "Balanço entre canal esquerdo e direito adequado."
        metrics.append(_build_metric("stereo", "Balanço L/R", "lr_balance",
                                     lr_balance, 0.0, "%", lr_status, False, lr_msg))

        # phase_correlation
        if phase_corr >= 0.7:
            pc_status = "ok"
        elif phase_corr >= 0.3:
            pc_status = "warning"
        else:
            pc_status = "critical"
        if pc_status == "critical":
            pc_msg = "Sua faixa tem cancelamento de fase — partes do som se anulam em mono. Verifique na DAW."
        elif pc_status == "warning":
            pc_msg = "A correlação de fase está baixa. Em sistemas mono a faixa pode soar mais fraca. Verifique os elementos estéreo na DAW."
        else:
            pc_msg = "Correlação de fase adequada — soa bem tanto em estéreo quanto em mono."
        metrics.append(_build_metric("stereo", "Correlação de fase", "phase_correlation",
                                     phase_corr, 1.0, "", pc_status, False, pc_msg))

        # ================================================================
        # Summary
        # ================================================================
        n_critical = sum(1 for m in metrics if m.status == "critical")
        n_warning  = sum(1 for m in metrics if m.status == "warning")

        if n_critical == 0 and n_warning == 0:
            summary_status = "ok"
            summary = f"Sua faixa está pronta para o {preset_label}. Nenhum problema encontrado."
        elif n_critical == 0:
            summary_status = "warning"
            summary = f"Encontramos {n_warning} ponto{'s' if n_warning > 1 else ''} de atenção. Verifique os detalhes abaixo."
        else:
            summary_status = "critical"
            summary = f"Encontramos {n_critical} problema{'s' if n_critical > 1 else ''} que precisa{'m' if n_critical > 1 else ''} de atenção antes de lançar."

        return AnalyzeResponse(
            summary=summary,
            summary_status=summary_status,
            metrics=metrics,
        )
