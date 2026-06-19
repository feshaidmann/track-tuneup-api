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
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-muted bg-surface">
      <span
        className="w-3.5 h-3.5 rounded-full border-2 border-brass border-t-transparent animate-spin shrink-0"
        aria-hidden
      />
      <span className="text-sm font-mono text-dim">{label}</span>
    </div>
  )
}

export default function App() {
  const [screen, setScreen]         = useState<Screen>('upload')
  const [loadingStep, setLoadingStep] = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState | null>(null)
  const [results, setResults]       = useState<ResultsState | null>(null)

  async function handleUpload(file: File, preset: string) {
    setError(null)
    try {
      const ctx = new AudioContext()
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
    }
  }

  async function handleCorrect() {
    if (!diagnostics) return
    const { file, preset, metrics: beforeMetrics } = diagnostics
    setError(null)

    try {
      const ctx = new AudioContext()

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

      setResults({ beforeMetrics, afterMetrics, downloadUrl, preset })
      setScreen('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.')
    } finally {
      setLoadingStep(null)
    }
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
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 py-12">
      {screen === 'upload' && (
        <div className="w-full max-w-lg space-y-4">
          <AudioUploader onSubmit={handleUpload} disabled={isLoading} />
          {isLoading && <Spinner label={loadingStep!} />}
          {error && (
            <p className="text-bad text-sm font-mono px-1">{error}</p>
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
          />
          {isLoading && <Spinner label={loadingStep!} />}
          {error && (
            <p className="text-bad text-sm font-mono px-1">{error}</p>
          )}
        </div>
      )}

      {screen === 'results' && results && (
        <div className="w-full max-w-2xl">
          <AnalysisResults
            beforeMetrics={results.beforeMetrics}
            afterMetrics={results.afterMetrics}
            downloadUrl={results.downloadUrl}
            preset={results.preset}
            onReset={handleReset}
          />
        </div>
      )}
    </div>
  )
}
