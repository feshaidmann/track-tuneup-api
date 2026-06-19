import { useRef, useState } from 'react'

const PRESET_OPTIONS = [
  { value: 'spotify',     label: 'Spotify' },
  { value: 'apple_music', label: 'Apple Music' },
  { value: 'youtube',     label: 'YouTube' },
  { value: 'club',        label: 'Club / DJ' },
  { value: 'radio',       label: 'Rádio' },
  { value: 'cd_master',   label: 'CD Master' },
]

const ACCEPTED = '.wav,.mp3,.flac,.aiff,.aif'
const MAX_SIZE = 200 * 1024 * 1024

interface Props {
  onSubmit: (file: File, preset: string) => void
  disabled: boolean
}

export function AudioUploader({ onSubmit, disabled }: Props) {
  const [preset, setPreset] = useState('spotify')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [fileError, setFileError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function validateFile(f: File): string {
    if (f.size > MAX_SIZE) return 'Arquivo muito grande. Limite: 200 MB.'
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['wav', 'mp3', 'flac', 'aiff', 'aif'].includes(ext))
      return 'Formato não suportado. Use WAV, MP3, FLAC ou AIFF.'
    return ''
  }

  function handleFile(f: File) {
    const err = validateFile(f)
    setFileError(err)
    if (!err) setFile(f)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    onSubmit(file, preset)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-1">Track Tuneup</h1>
        <p className="text-gray-400 text-sm">Análise e correção de áudio para streaming e masterização</p>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors
          ${dragOver ? 'border-emerald-500 bg-emerald-500/5' : 'border-gray-700 hover:border-gray-600 bg-gray-900/40'}
          ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
        </svg>
        {file ? (
          <p className="text-emerald-400 font-medium text-sm">{file.name}</p>
        ) : (
          <>
            <p className="text-gray-300 font-medium">Arraste ou clique para selecionar</p>
            <p className="text-gray-500 text-xs">WAV, MP3, FLAC, AIFF — até 200 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </div>

      {fileError && (
        <p className="text-red-400 text-sm">{fileError}</p>
      )}

      {/* Preset selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">Destino da faixa</label>
        <div className="grid grid-cols-3 gap-2">
          {PRESET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPreset(opt.value)}
              disabled={disabled}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors
                ${preset === opt.value
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}
                ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={!file || !!fileError || disabled}
        className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:pointer-events-none text-white font-semibold transition-colors"
      >
        Analisar e corrigir
      </button>
    </form>
  )
}
