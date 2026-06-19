export interface PresetCfg {
  integrated_lufs: number
  true_peak: number
  lra_min: number
  lra_max: number
}

export const PRESETS: Record<string, PresetCfg> = {
  spotify:     { integrated_lufs: -14.0, true_peak: -1.0, lra_min: 6,  lra_max: 18 },
  apple_music: { integrated_lufs: -16.0, true_peak: -1.0, lra_min: 6,  lra_max: 18 },
  youtube:     { integrated_lufs: -14.0, true_peak: -1.0, lra_min: 6,  lra_max: 18 },
  club:        { integrated_lufs: -7.5,  true_peak: -0.3, lra_min: 4,  lra_max: 10 },
  radio:       { integrated_lufs: -23.0, true_peak: -3.0, lra_min: 4,  lra_max: 15 },
  cd_master:   { integrated_lufs: -10.5, true_peak:  0.0, lra_min: 6,  lra_max: 14 },
}

export const PRESET_LABELS: Record<string, string> = {
  spotify: 'Spotify', apple_music: 'Apple Music', youtube: 'YouTube',
  club: 'Club / DJ', radio: 'Rádio', cd_master: 'CD Master',
}

export interface MetricRow {
  label: string
  key: string
  unit: string
  target: number | null
  lowerIsBetter?: boolean
  group: 'critical' | 'info'
}

export const ROWS: MetricRow[] = [
  { label: 'Volume integrado',     key: 'integrated_lufs',   unit: 'LUFS', target: null,  group: 'critical' },
  { label: 'Volume curto prazo',   key: 'short_term_lufs',   unit: 'LUFS', target: null,  group: 'critical' },
  { label: 'Pico verdadeiro',      key: 'true_peak',         unit: 'dBTP', target: null,  lowerIsBetter: true, group: 'critical' },
  { label: 'Pico de amostra',      key: 'sample_peak',       unit: 'dBFS', target: -0.5,  lowerIsBetter: true, group: 'info' },
  { label: 'Faixa dinâmica',       key: 'dynamic_range',     unit: 'dB',   target: 9.0,   group: 'info' },
  { label: 'Variação de loudness', key: 'loudness_range',    unit: 'LU',   target: null,  group: 'info' },
  { label: 'Balanço L/R',          key: 'lr_balance',        unit: '%',    target: 0.0,   lowerIsBetter: true, group: 'info' },
  { label: 'Correlação de fase',   key: 'phase_correlation', unit: '',     target: 1.0,   group: 'info' },
]

export function getTarget(row: MetricRow, cfg: PresetCfg): number {
  if (row.target !== null) return row.target
  if (row.key === 'integrated_lufs' || row.key === 'short_term_lufs') return cfg.integrated_lufs
  if (row.key === 'true_peak') return cfg.true_peak
  if (row.key === 'loudness_range') return (cfg.lra_min + cfg.lra_max) / 2
  return 0
}

export function deviation(value: number, target: number, lowerIsBetter: boolean): number {
  return lowerIsBetter ? value - target : Math.abs(value - target)
}

export function fmt(value: number, unit: string): string {
  return unit ? `${value.toFixed(1)} ${unit}` : value.toFixed(2)
}

// Resumo legível do alvo do preset, p/ tooltip/subtítulo (ex. "−14 LUFS · −1 dBTP")
export function presetSummary(preset: string): string {
  const cfg = PRESETS[preset]
  if (!cfg) return ''
  const i = cfg.integrated_lufs
  const tp = cfg.true_peak
  return `${i} LUFS · ${tp} dBTP`
}
