export interface AudioMetrics {
  integrated_lufs: number
  short_term_lufs: number
  true_peak: number
  sample_peak: number
  dynamic_range: number
  loudness_range: number
  lr_balance: number
  phase_correlation: number
}

export function analyzeAudio(audioBuffer: AudioBuffer): AudioMetrics {
  const channels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const length = audioBuffer.length

  const left = audioBuffer.getChannelData(0)
  const right = channels > 1 ? audioBuffer.getChannelData(1) : left

  // RMS global
  let sumSq = 0
  for (let i = 0; i < length; i++) {
    const avg = (left[i] + right[i]) / 2
    sumSq += avg * avg
  }
  const rms = Math.sqrt(sumSq / length)
  const integrated_lufs = rms > 0 ? 20 * Math.log10(rms) - 0.691 : -70

  // Short term LUFS (3s centrais)
  const window = Math.min(3 * sampleRate, length)
  const mid = Math.floor(length / 2)
  const start = mid - Math.floor(window / 2)
  let stSumSq = 0
  for (let i = start; i < start + window; i++) {
    const avg = (left[i] + right[i]) / 2
    stSumSq += avg * avg
  }
  const stRms = Math.sqrt(stSumSq / window)
  const short_term_lufs = stRms > 0 ? 20 * Math.log10(stRms) - 0.691 : -70

  // Sample peak (linear max)
  let maxAbs = 0
  for (let i = 0; i < length; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(left[i]), Math.abs(right[i]))
  }
  const sample_peak = maxAbs > 0 ? 20 * Math.log10(maxAbs) : -120

  // True peak — 4× linear interpolation to approximate inter-sample peaks
  const oversample = 4
  let maxInterSample = maxAbs
  for (let i = 1; i < length; i++) {
    for (let k = 1; k < oversample; k++) {
      const t = k / oversample
      const lInterp = left[i - 1] + t * (left[i] - left[i - 1])
      const rInterp = right[i - 1] + t * (right[i] - right[i - 1])
      maxInterSample = Math.max(maxInterSample, Math.abs(lInterp), Math.abs(rInterp))
    }
  }
  const true_peak = maxInterSample > 0 ? 20 * Math.log10(maxInterSample) : -120

  // Dynamic range
  const dynamic_range = true_peak - integrated_lufs

  // Loudness range (blocos de 3s)
  const blockSize = 3 * sampleRate
  const blockRms: number[] = []
  for (let b = 0; b + blockSize <= length; b += blockSize) {
    let bSumSq = 0
    for (let i = b; i < b + blockSize; i++) {
      const avg = (left[i] + right[i]) / 2
      bSumSq += avg * avg
    }
    const bRms = Math.sqrt(bSumSq / blockSize)
    if (bRms > 0) blockRms.push(20 * Math.log10(bRms))
  }
  blockRms.sort((a, b) => a - b)
  const p10 = blockRms[Math.floor(blockRms.length * 0.10)] ?? integrated_lufs
  const p95 = blockRms[Math.floor(blockRms.length * 0.95)] ?? integrated_lufs
  const loudness_range = Math.max(0, p95 - p10)

  // LR balance
  let rmsL = 0, rmsR = 0
  for (let i = 0; i < length; i++) {
    rmsL += left[i] * left[i]
    rmsR += right[i] * right[i]
  }
  rmsL = Math.sqrt(rmsL / length)
  rmsR = Math.sqrt(rmsR / length)
  const maxRms = Math.max(rmsL, rmsR)
  const lr_balance = maxRms > 0 ? Math.abs(rmsL - rmsR) / maxRms * 100 : 0

  // Phase correlation
  let dot = 0, sumL2 = 0, sumR2 = 0
  for (let i = 0; i < length; i++) {
    dot += left[i] * right[i]
    sumL2 += left[i] * left[i]
    sumR2 += right[i] * right[i]
  }
  const denom = Math.sqrt(sumL2 * sumR2)
  const phase_correlation = denom > 0 ? dot / denom : 1.0

  return {
    integrated_lufs: Math.round(integrated_lufs * 10) / 10,
    short_term_lufs: Math.round(short_term_lufs * 10) / 10,
    true_peak: Math.round(true_peak * 10) / 10,
    sample_peak: Math.round(sample_peak * 10) / 10,
    dynamic_range: Math.round(dynamic_range * 10) / 10,
    loudness_range: Math.round(loudness_range * 10) / 10,
    lr_balance: Math.round(lr_balance * 10) / 10,
    phase_correlation: Math.round(phase_correlation * 100) / 100,
  }
}
