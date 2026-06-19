import { useState } from 'react'
import { analyzeAudio, AudioMetrics } from './lib/audioAnalysis'
import { AudioUploader } from './components/AudioUploader'
import { AnalysisResults } from './components/AnalysisResults'

const RAILWAY_URL = 'https://track-tuneup-api-production.up.railway.app'

type LoadingStep =
  | 'Lendo o arquivo...'
  | 'Analisando original...'
  | 'Aplicando correções...'
  | 'Analisando resultado...'
  | 'Pronto!'

interface Results {
  beforeMetrics: AudioMetrics
  afterMetrics: AudioMetrics
  downloadUrl: string
  preset: string
}

export default function App() {
  const [loadingStep, setLoadingStep] = useState<LoadingStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Results | null>(null)

  async function handleAnalyze(file: File, preset: string) {
    setError(null)
    setResults(null)

    try {
      const audioContext = new AudioContext()

      setLoadingStep('Lendo o arquivo...')
      const rawBuffer = await file.arrayBuffer()

      setLoadingStep('Analisando original...')
      const originalAudioBuffer = await audioContext.decodeAudioData(rawBuffer.slice(0))
      const beforeMetrics = analyzeAudio(originalAudioBuffer)

      setLoadingStep('Aplicando correções...')
      const formData = new FormData()
      formData.append('file', file)
      formData.append('preset', preset)

      let response: Response
      try {
        response = await fetch(`${RAILWAY_URL}/analyze`, {
          method: 'POST',
          body: formData,
        })
      } catch {
        throw new Error('Não foi possível conectar ao servidor de processamento.')
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail ?? 'Falha no processamento.')
      }

      const correctedBlob = await response.blob()

      setLoadingStep('Analisando resultado...')
      const correctedBuffer = await correctedBlob.arrayBuffer()
      const correctedAudioBuffer = await audioContext.decodeAudioData(correctedBuffer.slice(0))
      const afterMetrics = analyzeAudio(correctedAudioBuffer)

      const downloadUrl = URL.createObjectURL(correctedBlob)

      setLoadingStep('Pronto!')
      setResults({ beforeMetrics, afterMetrics, downloadUrl, preset })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.')
    } finally {
      setLoadingStep(null)
    }
  }

  function handleReset() {
    if (results?.downloadUrl) URL.revokeObjectURL(results.downloadUrl)
    setResults(null)
    setError(null)
  }

  const isLoading = loadingStep !== null && loadingStep !== 'Pronto!'

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4 py-12">
      {results ? (
        <AnalysisResults
          beforeMetrics={results.beforeMetrics}
          afterMetrics={results.afterMetrics}
          downloadUrl={results.downloadUrl}
          preset={results.preset}
          onReset={handleReset}
        />
      ) : (
        <div className="w-full max-w-lg space-y-6">
          <AudioUploader onSubmit={handleAnalyze} disabled={isLoading} />

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
    </div>
  )
}
