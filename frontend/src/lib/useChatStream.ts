import { useCallback, useRef, useState } from 'react'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'https://track-tuneup-api-production.up.railway.app'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface UseChatStreamOpts {
  clientId: string
  preset: string
  analysisId?: string | null
  metricsBefore?: Record<string, number>
  metricsAfter?: Record<string, number>
}

// Hook de chat em streaming via SSE. Lê o ReadableStream da resposta do
// /api/chat, separa os frames por linha em branco e aplica cada delta na
// última mensagem do assistente. Sem libs externas.
export function useChatStream(opts: UseChatStreamOpts) {
  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const appendDelta = useCallback((delta: string) => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last && last.role === 'assistant') {
        next[next.length - 1] = { ...last, content: last.content + delta }
      }
      return next
    })
  }, [])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || streaming) return
      setError(null)

      const outgoing: ChatMessage[] = [...messages, { role: 'user', content }]
      setMessages([...outgoing, { role: 'assistant', content: '' }])
      setStreaming(true)

      const ctrl = new AbortController()
      abortRef.current = ctrl

      try {
        const res = await fetch(`${BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            client_id:      opts.clientId,
            analysis_id:    opts.analysisId ?? null,
            preset:         opts.preset,
            messages:       outgoing,
            metrics_before: opts.metricsBefore ?? null,
            metrics_after:  opts.metricsAfter ?? null,
          }),
        })

        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
        }

        const reader  = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const line = frame.trim()
            if (!line.startsWith('data:')) continue
            const json = line.slice(5).trim()
            if (!json) continue
            try {
              const evt = JSON.parse(json) as { delta?: string; error?: string; done?: boolean }
              if (evt.delta) appendDelta(evt.delta)
              else if (evt.error) setError(evt.error)
            } catch {
              /* frame parcial/ruído — ignora */
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError(e instanceof Error ? e.message : 'Erro inesperado.')
        }
      } finally {
        setStreaming(false)
        abortRef.current = null
        // Remove a bolha vazia do assistente se o stream falhou antes do 1º delta.
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          return last && last.role === 'assistant' && last.content === '' ? prev.slice(0, -1) : prev
        })
      }
    },
    [messages, streaming, opts, appendDelta],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { messages, streaming, error, send, stop }
}
