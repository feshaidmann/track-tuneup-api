import { AudioMetrics } from '../lib/audioAnalysis'

const PRESETS: Record<string, { integrated_lufs: number; true_peak: number; lra_min: number; lra_max: number }> = {
  spotify:     { integrated_lufs: -14.0, true_peak: -1.0, lra_min: 6,  lra_max: 18 },
  apple_music: { integrated_lufs: -16.0, true_peak: -1.0, lra_min: 6,  lra_max: 18 },
  youtube:     { integrated_lufs: -14.0, true_peak: -1.0, lra_min: 6,  lra_max: 18 },
  club:        { integrated_lufs: -7.5,  true_peak: -0.3, lra_min: 4,  lra_max: 10 },
  radio:       { integrated_lufs: -23.0, true_peak: -3.0, lra_min: 4,  lra_max: 15 },
  cd_master:   { integrated_lufs: -10.5, true_peak:  0.0, lra_min: 6,  lra_max: 14 },
}

type ConfirmationStatus = 'confirmed' | 'close' | 'off-target'

function getCorrectionStatus(after: AudioMetrics, cfg: typeof PRESETS[string]): ConfirmationStatus {
  const lufsDiff = Math.abs(after.integrated_lufs - cfg.integrated_lufs)
  const peakOk = after.true_peak <= cfg.true_peak + 0.1 // 0.1 dB tolerance for rounding
  if (lufsDiff <= 1.0 && peakOk) return 'confirmed'
  if (lufsDiff <= 2.0) return 'close'
  return 'off-target'
}

const STATUS_CONFIG = {
  confirmed: {
    label: '✓ Dentro do alvo',
    classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    detail: 'LUFS e true peak dentro dos limites do preset.',
  },
  close: {
    label: '⚠ Próximo do alvo',
    classes: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    detail: 'LUFS dentro de ±2 LU — aceitável, mas não ideal.',
  },
  'off-target': {
    label: '✗ Fora do alvo',
    classes: 'bg-red-500/15 text-red-400 border-red-500/30',
    detail: 'A correção não atingiu o alvo. Verifique o arquivo de origem.',
  },
}

const PRESET_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  apple_music: 'Apple Music',
  youtube: 'YouTube',
  club: 'Club / DJ',
  radio: 'Rádio',
  cd_master: 'CD Master',
}

interface Row {
  label: string
  key: keyof AudioMetrics
  unit: string
  target: number | null
  lowerIsBetter?: boolean
}

const ROWS: Row[] = [
  { label: 'Volume integrado',      key: 'integrated_lufs',  unit: 'LUFS', target: null },
  { label: 'Volume de curto prazo', key: 'short_term_lufs',  unit: 'LUFS', target: null },
  { label: 'Pico verdadeiro',       key: 'true_peak',        unit: 'dBTP', target: null, lowerIsBetter: true },
  { label: 'Pico de amostra',       key: 'sample_peak',      unit: 'dBFS', target: -0.5, lowerIsBetter: true },
  { label: 'Faixa dinâmica',        key: 'dynamic_range',    unit: 'dB',   target: 9.0 },
  { label: 'Variação de loudness',  key: 'loudness_range',   unit: 'LU',   target: null },
  { label: 'Balanço L/R',           key: 'lr_balance',       unit: '%',    target: 0.0, lowerIsBetter: true },
  { label: 'Correlação de fase',    key: 'phase_correlation', unit: '',    target: 1.0 },
]

function distanceFromTarget(value: number, target: number, lowerIsBetter: boolean): number {
  if (lowerIsBetter) return value - target
  return Math.abs(value - target)
}

function afterColor(before: number, after: number, target: number, lowerIsBetter = false): string {
  const distBefore = distanceFromTarget(before, target, lowerIsBetter)
  const distAfter = distanceFromTarget(after, target, lowerIsBetter)
  if (Math.abs(distAfter - distBefore) < 0.05) return 'text-gray-400'
  return distAfter < distBefore ? 'text-emerald-400' : 'text-red-400'
}

interface Props {
  beforeMetrics: AudioMetrics
  afterMetrics: AudioMetrics
  downloadUrl: string
  preset: string
  onReset: () => void
}

export function AnalysisResults({ beforeMetrics, afterMetrics, downloadUrl, preset, onReset }: Props) {
  const cfg = PRESETS[preset]
  const presetLabel = PRESET_LABELS[preset] ?? preset
  const status = getCorrectionStatus(afterMetrics, cfg)
  const statusCfg = STATUS_CONFIG[status]

  function getTarget(row: Row): number {
    if (row.target !== null) return row.target
    if (row.key === 'integrated_lufs' || row.key === 'short_term_lufs') return cfg.integrated_lufs
    if (row.key === 'true_peak') return cfg.true_peak
    if (row.key === 'loudness_range') return (cfg.lra_min + cfg.lra_max) / 2
    return 0
  }

  function fmt(value: number, unit: string): string {
    const str = value.toFixed(unit === '' ? 2 : 1)
    return unit ? `${str} ${unit}` : str
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold text-white">
          Correções aplicadas para {presetLabel}
        </h2>
        <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">
          Corrigido
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900 text-gray-400 text-left">
              <th className="px-4 py-3 font-medium">Métrica</th>
              <th className="px-4 py-3 font-medium text-right">Antes</th>
              <th className="px-4 py-3 font-medium text-right">Depois</th>
              <th className="px-4 py-3 font-medium text-right">Alvo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {ROWS.map((row) => {
              const target = getTarget(row)
              const before = beforeMetrics[row.key] as number
              const after = afterMetrics[row.key] as number
              const color = afterColor(before, after, target, row.lowerIsBetter)
              return (
                <tr key={row.key} className="bg-gray-950 hover:bg-gray-900/50 transition-colors">
                  <td className="px-4 py-3 text-gray-300">{row.label}</td>
                  <td className="px-4 py-3 text-right text-gray-400 font-mono">{fmt(before, row.unit)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-medium ${color}`}>{fmt(after, row.unit)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 font-mono">{fmt(target, row.unit)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Correction confirmation badge */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${statusCfg.classes}`}>
        <span className="font-semibold text-sm">{statusCfg.label}</span>
        <span className="text-xs opacity-75">{statusCfg.detail}</span>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Melhorou</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Piorou</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />Sem alteração</span>
      </div>

      {/* Footer actions */}
      <div className="flex gap-3 pt-2">
        <a
          href={downloadUrl}
          download="corrected.wav"
          className="flex-1 text-center px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
        >
          Baixar faixa corrigida
        </a>
        <button
          onClick={onReset}
          className="px-5 py-3 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold transition-colors"
        >
          Analisar outra faixa
        </button>
      </div>
    </div>
  )
}
