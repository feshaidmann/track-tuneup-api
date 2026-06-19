import { useState } from 'react'
import { analyzeAudio, AudioMetrics } from './lib/audioAnalysis'
import { AudioUploader } from './components/AudioUploader'
import { AudioDiagnostics } from './components/AudioDiagnostics'
import { AnalysisResults } from './components/AnalysisResults'

const RAILWAY_URL = 'https://track-tuneup-api-production.up.railway.app'

type Screen = 'upload' | 'diagnostics' | 'results'

interface DiagnosticsState {
  metrics: AudioMetrics
  file: File
  preset: string
}

interface ResultsState {
  beforeMetrics: AudioMetrics
  afterMetrics: AudioMetrics
  downloadUrl: string
  preset: string
  file: File
  correctedBlob: Blob
  correctedBuffer: AudioBuffer
}

const STEPS: { id: Screen; label: string }[] = [
  { id: 'upload',      label: 'Enviar' },
  { id: 'diagnostics', label: 'Diagnóstico' },
  { id: 'results',     label: 'Resultado' },
]

function Stepper({ current }: { current: Screen }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current)
  return (
    <nav aria-label="Progresso" className="flex items-center gap-2 text-xs font-mono">
      {STEPS.map((step, i) => {
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'todo'
        return (
          <div key={step.id} className="flex items-center gap-2">
            <span
              aria-current={state === 'active' ? 'step' : undefined}
              className={[
                'flex items-center gap-1.5',
                state === 'active' ? 'text-brass' : state === 'done' ? 'text-dim' : 'text-faint',
              ].join(' ')}
            >
              <span
                className={[
                  'w-4 h-4 rounded-full border flex items-center justify-center text-[10px]',
                  state === 'active' ? 'border-brass' : state === 'done' ? 'border-dim' : 'border-faint',
                ].join(' ')}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              {step.label}
            </span>
            {i < STEPS.length - 1 && <span className="text-faint" aria-hidden>·</span>}
          </div>
        )
      })}
    </nav>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-3 rounded-lg border border-muted bg-surface"
    >
      <span
        className="w-3.5 h-3.5 rounded-full border-2 border-brass border-t-transparent animate-spin shrink-0"
        aria-hidden
      />
      <span className="text-sm font-mono text-dim">{label}</span>
    </div>
  )
}

export default function App() {
  const [screen, setScreen]           = useState<Screen>('upload')
  const [loadingStep, setLoadingStep] = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState | null>(null)
  const [results, setResults]         = useState<ResultsState | null>(null)

  async function handleUpload(file: File, preset: string) {
    setError(null)
    const ctx = new AudioContext()
    try {
      setLoadingStep('Lendo o arquivo...')
      const raw = await file.arrayBuffer()
      setLoadingStep('Analisando...')
      const buf = await ctx.decodeAudioData(raw)
      const metrics = analyzeAudio(buf)
      setDiagnostics({ metrics, file, preset })
      setScreen('diagnostics')
    } catch {
      setError('Não foi possível analisar o arquivo. Verifique o formato.')
    } finally {
      setLoadingStep(null)
      ctx.close()
    }
  }

  // Processa a faixa no backend e mede o resultado. Reutilizada pela correção
  // inicial e pela troca de preset na tela de resultado.
  async function runCorrection(file: File, preset: string, beforeMetrics: AudioMetrics, previousUrl?: string) {
    setError(null)
    const ctx = new AudioContext()
    try {
      setLoadingStep('Aplicando correções...')
      const formData = new FormData()
      formData.append('file', file)
      formData.append('preset', preset)

      let response: Response
      try {
        response = await fetch(`${RAILWAY_URL}/analyze`, { method: 'POST', body: formData })
      } catch {
        throw new Error('Não foi possível conectar ao servidor de processamento.')
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Falha no processamento.')
      }

      const blob = await response.blob()

      setLoadingStep('Medindo resultado...')
      const correctedAudioBuffer = await ctx.decodeAudioData(await blob.arrayBuffer())
      const afterMetrics = analyzeAudio(correctedAudioBuffer)
      const downloadUrl  = URL.createObjectURL(blob)

      if (previousUrl) URL.revokeObjectURL(previousUrl)
      setResults({ beforeMetrics, afterMetrics, downloadUrl, preset, file, correctedBlob: blob, correctedBuffer: correctedAudioBuffer })
      setScreen('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.')
    } finally {
      setLoadingStep(null)
      ctx.close()
    }
  }

  function handleCorrect() {
    if (!diagnostics) return
    runCorrection(diagnostics.file, diagnostics.preset, diagnostics.metrics)
  }

  function handleRetryPreset(preset: string) {
    if (!results) return
    runCorrection(results.file, preset, results.beforeMetrics, results.downloadUrl)
  }

  function handleReset() {
    if (results?.downloadUrl) URL.revokeObjectURL(results.downloadUrl)
    setDiagnostics(null)
    setResults(null)
    setError(null)
    setScreen('upload')
  }

  const isLoading = loadingStep !== null

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center px-4 py-12">
      <header className="w-full max-w-2xl flex items-center justify-between gap-4 mb-8">
        <h1 className="text-base font-bold text-fg tracking-tight">Track Tuneup</h1>
        <Stepper current={screen} />
      </header>

      {screen === 'upload' && (
        <div className="w-full max-w-lg space-y-4">
          <AudioUploader onSubmit={handleUpload} disabled={isLoading} />
          {isLoading && <Spinner label={loadingStep!} />}
          {error && (
            <p role="alert" className="text-bad text-sm font-mono px-1">{error}</p>
          )}
        </div>
      )}

      {screen === 'diagnostics' && diagnostics && (
        <div className="w-full max-w-2xl space-y-4">
          <AudioDiagnostics
            metrics={diagnostics.metrics}
            preset={diagnostics.preset}
            filename={diagnostics.file.name}
            onCorrect={handleCorrect}
            onReset={handleReset}
            disabled={isLoading}
          />
          {isLoading && <Spinner label={loadingStep!} />}
          {error && (
            <p role="alert" className="text-bad text-sm font-mono px-1">{error}</p>
          )}
        </div>
      )}

      {screen === 'results' && results && (
        <div className="w-full max-w-2xl space-y-4">
          <AnalysisResults
            beforeMetrics={results.beforeMetrics}
            afterMetrics={results.afterMetrics}
            downloadUrl={results.downloadUrl}
            preset={results.preset}
            filename={results.file.name}
            originalFile={results.file}
            correctedBlob={results.correctedBlob}
            correctedBuffer={results.correctedBuffer}
            onReset={handleReset}
            onRetryPreset={handleRetryPreset}
            disabled={isLoading}
          />
          {isLoading && <Spinner label={loadingStep!} />}
          {error && (
            <p role="alert" className="text-bad text-sm font-mono px-1">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
