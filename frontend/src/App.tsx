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

export default function App() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [loadingStep, setLoadingStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState | null>(null)
  const [results, setResults] = useState<ResultsState | null>(null)

  async function handleUpload(file: File, preset: string) {
    setError(null)
    try {
      const audioContext = new AudioContext()
      setLoadingStep('Lendo o arquivo...')
      const rawBuffer = await file.arrayBuffer()
      setLoadingStep('Analisando original...')
      const audioBuffer = await audioContext.decodeAudioData(rawBuffer)
      const metrics = analyzeAudio(audioBuffer)
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
      const audioContext = new AudioContext()

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

      const correctedBlob = await response.blob()

      setLoadingStep('Analisando resultado...')
      const correctedBuffer = await correctedBlob.arrayBuffer()
      const correctedAudioBuffer = await audioContext.decodeAudioData(correctedBuffer)
      const afterMetrics = analyzeAudio(correctedAudioBuffer)

      const downloadUrl = URL.createObjectURL(correctedBlob)

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
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4 py-12">
      {screen === 'upload' && (
        <div className="w-full max-w-lg space-y-6">
          <AudioUploader onSubmit={handleUpload} disabled={isLoading} />
          {isLoading && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-900 border border-gray-800">
              <span className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-sm text-gray-300">{loadingStep}</span>
            </div>
          )}
          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>
      )}

      {screen === 'diagnostics' && diagnostics && (
        <div className="w-full max-w-3xl space-y-6">
          <AudioDiagnostics
            metrics={diagnostics.metrics}
            preset={diagnostics.preset}
            filename={diagnostics.file.name}
            onCorrect={handleCorrect}
            onReset={handleReset}
          />
          {isLoading && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-900 border border-gray-800">
              <span className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-sm text-gray-300">{loadingStep}</span>
            </div>
          )}
          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>
      )}

      {screen === 'results' && results && (
        <AnalysisResults
          beforeMetrics={results.beforeMetrics}
          afterMetrics={results.afterMetrics}
          downloadUrl={results.downloadUrl}
          preset={results.preset}
          onReset={handleReset}
        />
      )}
    </div>
  )
}
