import { AudioMetrics } from '../lib/audioAnalysis'
import { PRESETS, PRESET_LABELS, ROWS, getTarget, deviation, fmt } from '../lib/presets'

function valueColor(value: number, target: number, lowerIsBetter: boolean): string {
  const d = deviation(value, target, lowerIsBetter)
  if (d <= 1.0) return 'text-ok'
  if (d <= 3.0) return 'text-warn'
  return 'text-bad'
}

function buildVerdict(metrics: AudioMetrics, preset: string): string {
  const cfg = PRESETS[preset]
  const label = PRESET_LABELS[preset] ?? preset
  const lufsDiff = metrics.integrated_lufs - cfg.integrated_lufs
  const peakOk = metrics.true_peak <= cfg.true_peak

  if (Math.abs(lufsDiff) <= 1.0 && peakOk) {
    return `Sua faixa já está dentro do padrão ${label}. Você pode corrigir assim mesmo para normalizar o arquivo.`
  }

  const parts: string[] = []

  if (Math.abs(lufsDiff) > 1.0) {
    const dir = lufsDiff > 0 ? 'acima' : 'abaixo'
    parts.push(`O volume está ${Math.abs(lufsDiff).toFixed(1)} LUFS ${dir} do ideal para ${label}`)
  }

  if (!peakOk) {
    const excess = (metrics.true_peak - cfg.true_peak).toFixed(1)
    parts.push(`o pico verdadeiro está ${excess} dB acima do limite`)
  }

  return parts.join(' e ') + '. Vamos corrigir.'
}

interface Props {
  metrics: AudioMetrics
  preset: string
  filename: string
  onCorrect: () => void
  onReset: () => void
  disabled?: boolean
}

export function AudioDiagnostics({ metrics, preset, filename, onCorrect, onReset, disabled = false }: Props) {
  const cfg = PRESETS[preset]
  const presetLabel = PRESET_LABELS[preset] ?? preset

  const issues = ROWS.filter((row) => {
    const d = deviation(metrics[row.key as keyof AudioMetrics] as number, getTarget(row, cfg), row.lowerIsBetter ?? false)
    return d > 1.0
  }).length

  const verdict = buildVerdict(metrics, preset)

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

      {/* Human-readable verdict */}
      <p className="text-sm text-dim leading-relaxed">{verdict}</p>

      {/* Metrics table */}
      <div className="rounded-lg border border-muted overflow-x-auto">
        <table className="w-full min-w-[28rem]">
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
              const value = metrics[row.key as keyof AudioMetrics] as number
              const color = valueColor(value, target, row.lowerIsBetter ?? false)
              const targetLabel = row.key === 'loudness_range'
                ? `${cfg.lra_min}–${cfg.lra_max} ${row.unit}`
                : fmt(target, row.unit)
              return (
                <tr key={row.key} className="bg-canvas hover:bg-surface/60 transition-colors">
                  <td className="px-4 py-3 text-sm text-fg">{row.label}</td>
                  <td className={`px-4 py-3 text-right font-mono text-sm font-medium ${color}`}>
                    {fmt(value, row.unit)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-faint">
                    {targetLabel}
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
          disabled={disabled}
          className="flex-1 py-3 rounded bg-brass text-canvas font-bold text-sm tracking-wide hover:bg-brass-dim transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          Corrigir volume e picos →
        </button>
        <button
          onClick={onReset}
          disabled={disabled}
          className="px-6 py-3 rounded border border-muted text-dim text-sm font-medium hover:border-faint hover:text-fg transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          Trocar arquivo
        </button>
      </div>
    </div>
  )
}
