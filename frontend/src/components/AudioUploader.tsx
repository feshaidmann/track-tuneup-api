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
    <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-8">
      <div>
        <h1 className="text-xl font-bold text-fg tracking-tight mb-1">Track Tuneup</h1>
        <p className="text-sm text-dim">Análise e correção de loudness para streaming e masterização</p>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={[
          'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 cursor-pointer transition-colors',
          dragOver
            ? 'border-brass bg-brass-faint'
            : 'border-muted hover:border-faint bg-surface',
          disabled ? 'pointer-events-none opacity-40' : '',
        ].join(' ')}
      >
        {file ? (
          <p className="text-brass font-mono text-sm">{file.name}</p>
        ) : (
          <>
            <p className="text-fg text-sm font-medium">Arraste ou clique para selecionar</p>
            <p className="text-dim text-xs font-mono">WAV · MP3 · FLAC · AIFF — até 200 MB</p>
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
        <p className="text-bad text-sm font-mono">{fileError}</p>
      )}

      {/* Preset selector */}
      <div className="space-y-3">
        <label className="block text-xs font-medium text-dim uppercase tracking-widest">
          Destino
        </label>
        <div className="grid grid-cols-3 gap-2">
          {PRESET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPreset(opt.value)}
              disabled={disabled}
              className={[
                'px-3 py-2 rounded text-sm font-medium transition-colors border',
                preset === opt.value
                  ? 'bg-brass-faint border-brass text-brass'
                  : 'bg-surface border-muted text-dim hover:border-faint hover:text-fg',
                disabled ? 'opacity-40 pointer-events-none' : '',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={!file || !!fileError || disabled}
        className="w-full py-3 rounded bg-brass text-canvas font-bold text-sm tracking-wide hover:bg-brass-dim transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        Analisar
      </button>
    </form>
  )
}
