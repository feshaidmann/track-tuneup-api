import { AudioMetrics } from '../lib/audioAnalysis'
import { PRESETS, PRESET_LABELS, ROWS, getTarget, fmt } from '../lib/presets'

function distFromTarget(value: number, target: number, lowerIsBetter: boolean): number {
  return lowerIsBetter ? value - target : Math.abs(value - target)
}

type Change = 'better' | 'worse' | 'same'

function changeOf(before: number, after: number, target: number, lowerIsBetter = false): Change {
  const dBefore = distFromTarget(before, target, lowerIsBetter)
  const dAfter  = distFromTarget(after,  target, lowerIsBetter)
  if (Math.abs(dAfter - dBefore) < 0.05) return 'same'
  return dAfter < dBefore ? 'better' : 'worse'
}

// Símbolo redundante à cor (WCAG 1.4.1)
const CHANGE_GLYPH: Record<Change, string> = { better: '✓', worse: '✗', same: '·' }
const CHANGE_COLOR: Record<Change, string> = { better: 'text-ok', worse: 'text-bad', same: 'text-dim' }

function fmtDelta(before: number, after: number, unit: string): string {
  const d = after - before
  if (Math.abs(d) < 0.05) return '—'
  const sign = d > 0 ? '+' : ''
  return unit ? `${sign}${d.toFixed(1)} ${unit}` : `${sign}${d.toFixed(2)}`
}

type ConfirmationStatus = 'confirmed' | 'close' | 'off-target'

function getStatus(after: AudioMetrics, cfg: typeof PRESETS[string]): ConfirmationStatus {
  const lufsDiff = Math.abs(after.integrated_lufs - cfg.integrated_lufs)
  const peakOk   = after.true_peak <= cfg.true_peak + 0.1
  if (lufsDiff <= 1.0 && peakOk) return 'confirmed'
  if (lufsDiff <= 2.0) return 'close'
  return 'off-target'
}

const STATUS_CONFIG = {
  confirmed: {
    label: '✓ Dentro do alvo',
    classes: 'text-ok bg-ok/10 border-ok/20',
    detail: 'LUFS e true peak confirmados pela medição do arquivo recebido.',
  },
  close: {
    label: '⚠ Próximo do alvo',
    classes: 'text-warn bg-warn/10 border-warn/20',
    detail: 'LUFS dentro de ±2 LU — aceitável, mas não ideal.',
  },
  'off-target': {
    label: '✗ Fora do alvo',
    classes: 'text-bad bg-bad/10 border-bad/20',
    detail: 'Correção não atingiu o alvo. Verifique o arquivo de origem.',
  },
}

interface Props {
  beforeMetrics: AudioMetrics
  afterMetrics: AudioMetrics
  downloadUrl: string
  preset: string
  filename: string
  onReset: () => void
  onRetryPreset: (preset: string) => void
  disabled?: boolean
}

function downloadName(original: string, preset: string): string {
  const base = original.replace(/\.[^.]+$/, '') || 'faixa'
  return `${base}_${preset}.wav`
}

export function AnalysisResults({
  beforeMetrics, afterMetrics, downloadUrl, preset, filename, onReset, onRetryPreset, disabled = false,
}: Props) {
  const cfg         = PRESETS[preset]
  const presetLabel = PRESET_LABELS[preset] ?? preset
  const status      = getStatus(afterMetrics, cfg)
  const statusCfg   = STATUS_CONFIG[status]
  const otherPresets = Object.keys(PRESETS).filter((p) => p !== preset)

  return (
    <div className="w-full max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs text-dim uppercase tracking-widest mb-1 font-mono">{presetLabel}</p>
          <h2 className="text-lg font-bold text-fg">Resultado</h2>
        </div>
        <span className={`text-xs font-mono font-medium border px-2 py-1 rounded ${statusCfg.classes}`}>
          {statusCfg.label}
        </span>
      </div>

      <p className="text-xs text-dim font-mono">{statusCfg.detail}</p>

      {/* Comparison table */}
      <div className="rounded-lg border border-muted overflow-x-auto">
        <table className="w-full min-w-[34rem]">
          <thead>
            <tr className="bg-surface border-b border-muted">
              <th className="px-4 py-3 text-left text-xs font-medium text-dim uppercase tracking-widest">Métrica</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-dim uppercase tracking-widest">Antes</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-dim uppercase tracking-widest">Depois</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-dim uppercase tracking-widest">Δ</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-dim uppercase tracking-widest">Alvo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-muted">
            {ROWS.map((row) => {
              const target = getTarget(row, cfg)
              const before = beforeMetrics[row.key as keyof AudioMetrics] as number
              const after  = afterMetrics[row.key as keyof AudioMetrics]  as number
              const change = changeOf(before, after, target, row.lowerIsBetter)
              const targetLabel = row.key === 'loudness_range'
                ? `${cfg.lra_min}–${cfg.lra_max} ${row.unit}`
                : fmt(target, row.unit)
              return (
                <tr key={row.key} className="bg-canvas hover:bg-surface/60 transition-colors">
                  <td className="px-4 py-3 text-sm text-fg">{row.label}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-dim">{fmt(before, row.unit)}</td>
                  <td className={`px-4 py-3 text-right font-mono text-sm font-medium ${CHANGE_COLOR[change]}`}>
                    <span aria-hidden className="inline-block w-3 mr-1.5 text-center">{CHANGE_GLYPH[change]}</span>
                    {fmt(after, row.unit)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono text-xs ${CHANGE_COLOR[change]}`}>{fmtDelta(before, after, row.unit)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-dim">{targetLabel}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex gap-6 text-xs font-mono text-dim">
        <span className="flex items-center gap-1.5"><span className="text-ok" aria-hidden>✓</span>melhorou</span>
        <span className="flex items-center gap-1.5"><span className="text-bad" aria-hidden>✗</span>piorou</span>
        <span className="flex items-center gap-1.5"><span className="text-dim" aria-hidden>·</span>sem alteração</span>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <a
          href={downloadUrl}
          download={downloadName(filename, preset)}
          className="flex-1 text-center py-3 rounded bg-brass text-canvas font-bold text-sm tracking-wide hover:bg-brass-dim transition-colors"
        >
          Baixar faixa corrigida
        </a>
        <button
          onClick={onReset}
          disabled={disabled}
          className="px-6 py-3 rounded border border-muted text-dim text-sm font-medium hover:border-faint hover:text-fg transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          Nova análise
        </button>
      </div>

      {/* Testar outro preset com o mesmo arquivo */}
      <div className="space-y-2 pt-2">
        <p className="text-xs text-dim font-mono">Testar outro destino com o mesmo arquivo:</p>
        <div className="grid grid-cols-3 gap-2">
          {otherPresets.map((p) => (
            <button
              key={p}
              onClick={() => onRetryPreset(p)}
              disabled={disabled}
              className="px-3 py-2 rounded text-sm font-medium border bg-surface border-muted text-dim hover:border-faint hover:text-fg transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              {PRESET_LABELS[p] ?? p}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
