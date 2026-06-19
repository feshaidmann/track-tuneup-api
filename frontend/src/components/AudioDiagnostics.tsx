import { AudioMetrics } from '../lib/audioAnalysis'

const PRESETS: Record<string, { integrated_lufs: number; true_peak: number; lra_min: number; lra_max: number }> = {
  spotify:     { integrated_lufs: -14.0, true_peak: -1.0, lra_min: 6,  lra_max: 18 },
  apple_music: { integrated_lufs: -16.0, true_peak: -1.0, lra_min: 6,  lra_max: 18 },
  youtube:     { integrated_lufs: -14.0, true_peak: -1.0, lra_min: 6,  lra_max: 18 },
  club:        { integrated_lufs: -7.5,  true_peak: -0.3, lra_min: 4,  lra_max: 10 },
  radio:       { integrated_lufs: -23.0, true_peak: -3.0, lra_min: 4,  lra_max: 15 },
  cd_master:   { integrated_lufs: -10.5, true_peak:  0.0, lra_min: 6,  lra_max: 14 },
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
  { label: 'Volume integrado',      key: 'integrated_lufs',   unit: 'LUFS', target: null },
  { label: 'Volume de curto prazo', key: 'short_term_lufs',   unit: 'LUFS', target: null },
  { label: 'Pico verdadeiro',       key: 'true_peak',         unit: 'dBTP', target: null, lowerIsBetter: true },
  { label: 'Pico de amostra',       key: 'sample_peak',       unit: 'dBFS', target: -0.5, lowerIsBetter: true },
  { label: 'Faixa dinâmica',        key: 'dynamic_range',     unit: 'dB',   target: 9.0 },
  { label: 'Variação de loudness',  key: 'loudness_range',    unit: 'LU',   target: null },
  { label: 'Balanço L/R',           key: 'lr_balance',        unit: '%',    target: 0.0, lowerIsBetter: true },
  { label: 'Correlação de fase',    key: 'phase_correlation', unit: '',     target: 1.0 },
]

function getTarget(row: Row, cfg: typeof PRESETS[string]): number {
  if (row.target !== null) return row.target
  if (row.key === 'integrated_lufs' || row.key === 'short_term_lufs') return cfg.integrated_lufs
  if (row.key === 'true_peak') return cfg.true_peak
  if (row.key === 'loudness_range') return (cfg.lra_min + cfg.lra_max) / 2
  return 0
}

function statusColor(value: number, target: number, lowerIsBetter: boolean): string {
  const dist = lowerIsBetter ? value - target : Math.abs(value - target)
  if (dist <= 1.0) return 'text-emerald-400'
  if (dist <= 3.0) return 'text-yellow-400'
  return 'text-red-400'
}

function fmt(value: number, unit: string): string {
  return unit ? `${value.toFixed(1)} ${unit}` : value.toFixed(2)
}

interface Props {
  metrics: AudioMetrics
  preset: string
  filename: string
  onCorrect: () => void
  onReset: () => void
}

export function AudioDiagnostics({ metrics, preset, filename, onCorrect, onReset }: Props) {
  const cfg = PRESETS[preset]
  const presetLabel = PRESET_LABELS[preset] ?? preset

  const issues = ROWS.filter((row) => {
    const target = getTarget(row, cfg)
    const value = metrics[row.key] as number
    const dist = row.lowerIsBetter ? value - target : Math.abs(value - target)
    return dist > 1.0
  }).length

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-xl font-semibold text-white">Diagnóstico — {presetLabel}</h2>
          {issues === 0 ? (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">
              Pronto para lançar
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 uppercase tracking-wide">
              {issues} {issues === 1 ? 'ajuste' : 'ajustes'} necessário{issues === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="text-gray-500 text-sm truncate">{filename}</p>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900 text-gray-400 text-left">
              <th className="px-4 py-3 font-medium">Métrica</th>
              <th className="px-4 py-3 font-medium text-right">Valor</th>
              <th className="px-4 py-3 font-medium text-right">Alvo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {ROWS.map((row) => {
              const target = getTarget(row, cfg)
              const value = metrics[row.key] as number
              const color = statusColor(value, target, row.lowerIsBetter ?? false)
              return (
                <tr key={row.key} className="bg-gray-950 hover:bg-gray-900/50 transition-colors">
                  <td className="px-4 py-3 text-gray-300">{row.label}</td>
                  <td className={`px-4 py-3 text-right font-mono font-medium ${color}`}>{fmt(value, row.unit)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 font-mono">{fmt(target, row.unit)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Dentro do alvo</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />Atenção</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Fora do alvo</span>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onCorrect}
          className="flex-1 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
        >
          Aplicar correção
        </button>
        <button
          onClick={onReset}
          className="px-5 py-3 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold transition-colors"
        >
          Trocar arquivo
        </button>
      </div>
    </div>
  )
}
