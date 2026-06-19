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
  spotify: 'Spotify', apple_music: 'Apple Music', youtube: 'YouTube',
  club: 'Club / DJ', radio: 'Rádio', cd_master: 'CD Master',
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
  { label: 'Volume curto prazo',    key: 'short_term_lufs',   unit: 'LUFS', target: null },
  { label: 'Pico verdadeiro',       key: 'true_peak',         unit: 'dBTP', target: null, lowerIsBetter: true },
  { label: 'Pico de amostra',       key: 'sample_peak',       unit: 'dBFS', target: -0.5, lowerIsBetter: true },
  { label: 'Faixa dinâmica',        key: 'dynamic_range',     unit: 'dB',   target: 9.0 },
  { label: 'Variação de loudness',  key: 'loudness_range',    unit: 'LU',   target: null },
  { label: 'Balanço L/R',           key: 'lr_balance',        unit: '%',    target: 0.0,  lowerIsBetter: true },
  { label: 'Correlação de fase',    key: 'phase_correlation', unit: '',     target: 1.0 },
]

function getTarget(row: Row, cfg: typeof PRESETS[string]): number {
  if (row.target !== null) return row.target
  if (row.key === 'integrated_lufs' || row.key === 'short_term_lufs') return cfg.integrated_lufs
  if (row.key === 'true_peak') return cfg.true_peak
  if (row.key === 'loudness_range') return (cfg.lra_min + cfg.lra_max) / 2
  return 0
}

function deviation(value: number, target: number, lowerIsBetter: boolean): number {
  return lowerIsBetter ? value - target : Math.abs(value - target)
}

function valueColor(value: number, target: number, lowerIsBetter: boolean): string {
  const d = deviation(value, target, lowerIsBetter)
  if (d <= 1.0) return 'text-ok'
  if (d <= 3.0) return 'text-warn'
  return 'text-bad'
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
    const d = deviation(metrics[row.key] as number, getTarget(row, cfg), row.lowerIsBetter ?? false)
    return d > 1.0
  }).length

  return (
    <div className="w-full max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs text-dim uppercase tracking-widest mb-1 font-mono">{presetLabel}</p>
          <h2 className="text-lg font-bold text-fg">Diagnóstico</h2>
        </div>
        <div className="text-right">
          {issues === 0 ? (
            <span className="text-xs font-mono font-medium text-ok bg-ok/10 border border-ok/20 px-2 py-1 rounded">
              Dentro do alvo
            </span>
          ) : (
            <span className="text-xs font-mono font-medium text-warn bg-warn/10 border border-warn/20 px-2 py-1 rounded">
              {issues} {issues === 1 ? 'ajuste' : 'ajustes'}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-faint font-mono truncate">{filename}</p>

      {/* Metrics table */}
      <div className="rounded-lg border border-muted overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-surface border-b border-muted">
              <th className="px-4 py-3 text-left text-xs font-medium text-dim uppercase tracking-widest">Métrica</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-dim uppercase tracking-widest">Valor</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-dim uppercase tracking-widest">Alvo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-muted">
            {ROWS.map((row) => {
              const target = getTarget(row, cfg)
              const value = metrics[row.key] as number
              const color = valueColor(value, target, row.lowerIsBetter ?? false)
              return (
                <tr key={row.key} className="bg-canvas hover:bg-surface/60 transition-colors">
                  <td className="px-4 py-3 text-sm text-fg">{row.label}</td>
                  <td className={`px-4 py-3 text-right font-mono text-sm font-medium ${color}`}>
                    {fmt(value, row.unit)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-faint">
                    {fmt(target, row.unit)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex gap-6 text-xs font-mono text-faint">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-ok inline-block" />ok</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-warn inline-block" />atenção</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-bad inline-block" />fora do alvo</span>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onCorrect}
          className="flex-1 py-3 rounded bg-brass text-canvas font-bold text-sm tracking-wide hover:bg-brass-dim transition-colors"
        >
          Aplicar correção
        </button>
        <button
          onClick={onReset}
          className="px-6 py-3 rounded border border-muted text-dim text-sm font-medium hover:border-faint hover:text-fg transition-colors"
        >
          Trocar arquivo
        </button>
      </div>
    </div>
  )
}
