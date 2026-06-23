import { useEffect, useRef, useState } from 'react'
import { AudioMetrics } from '../lib/audioAnalysis'
import { useChatStream } from '../lib/useChatStream'
import { getClientId } from '../lib/client_id'

interface Props {
  preset: string
  beforeMetrics: AudioMetrics
  afterMetrics: AudioMetrics
  analysisId?: string | null
}

const SUGGESTIONS = [
  'O que mudou na minha faixa?',
  'Por que o true peak importa?',
  'Está pronto pro Spotify?',
]

export function ResultsChat({ preset, beforeMetrics, afterMetrics, analysisId }: Props) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const { messages, streaming, error, send } = useChatStream({
    clientId:      getClientId(),
    preset,
    analysisId,
    metricsBefore: beforeMetrics as unknown as Record<string, number>,
    metricsAfter:  afterMetrics as unknown as Record<string, number>,
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  function submit(text: string) {
    if (!text.trim() || streaming) return
    send(text)
    setInput('')
  }

  const empty = messages.length === 0

  return (
    <div className="rounded-lg border border-muted bg-surface/40">
      <div className="px-4 py-3 border-b border-muted">
        <h3 className="text-sm font-bold text-fg">Consultor de masterização</h3>
        <p className="text-xs text-dim font-mono mt-0.5">Tire dúvidas sobre o resultado da sua faixa.</p>
      </div>

      {/* Histórico */}
      <div ref={scrollRef} className="max-h-80 overflow-y-auto px-4 py-4 space-y-3">
        {empty && (
          <div className="space-y-3">
            <p className="text-sm text-dim">Pergunte o que quiser sobre a análise — ou comece por aqui:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  disabled={streaming}
                  className="px-3 py-1.5 rounded-full text-xs border border-muted text-dim hover:border-brass hover:text-brass transition-colors disabled:opacity-30"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={[
                'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                m.role === 'user'
                  ? 'bg-brass/15 text-fg border border-brass/20'
                  : 'bg-canvas text-fg border border-muted',
              ].join(' ')}
            >
              {m.content || (streaming && i === messages.length - 1 ? (
                <span className="inline-flex gap-1 items-center text-dim">
                  <span className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" />
                  pensando…
                </span>
              ) : null)}
            </div>
          </div>
        ))}

        {error && <p role="alert" className="text-bad text-xs font-mono">{error}</p>}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); submit(input) }}
        className="flex gap-2 px-4 py-3 border-t border-muted"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte ao consultor…"
          disabled={streaming}
          className="flex-1 bg-canvas border border-muted rounded px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-brass focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="px-4 py-2 rounded bg-brass text-canvas font-bold text-sm hover:bg-brass-dim transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          Enviar
        </button>
      </form>
    </div>
  )
}
