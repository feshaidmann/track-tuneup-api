import { useEffect, useRef, useState } from 'react'

type Track = 'original' | 'corrected'

function computeMatchGains(originalLufs: number, correctedLufs: number) {
  // Referência: o mais baixo dos dois vira o alvo — só atenua, nunca amplifica
  // (evita clipping ao igualar o volume percebido).
  const reference = Math.min(originalLufs, correctedLufs)
  return {
    original: Math.pow(10, (reference - originalLufs) / 20),
    corrected: Math.pow(10, (reference - correctedLufs) / 20),
  }
}

// Reprodução paralela dos dois áudios em sincronia. A troca A/B apenas
// reequilibra os GainNodes, sem reiniciar os sources — troca instantânea.
class ABPlayer {
  private ctx: AudioContext
  private originalBuffer: AudioBuffer
  private correctedBuffer: AudioBuffer
  private originalGain: GainNode
  private correctedGain: GainNode
  private originalSource: AudioBufferSourceNode | null = null
  private correctedSource: AudioBufferSourceNode | null = null
  private startTime = 0
  private pauseOffset = 0
  private isPlaying = false
  private activeTrack: Track = 'corrected'
  private loudnessMatch = true
  private originalLufs: number
  private correctedLufs: number

  onEnded: (() => void) | null = null

  constructor(
    ctx: AudioContext,
    originalBuffer: AudioBuffer,
    correctedBuffer: AudioBuffer,
    originalLufs: number,
    correctedLufs: number,
  ) {
    this.ctx = ctx
    this.originalBuffer = originalBuffer
    this.correctedBuffer = correctedBuffer
    this.originalLufs = originalLufs
    this.correctedLufs = correctedLufs
    this.originalGain = ctx.createGain()
    this.correctedGain = ctx.createGain()
    this.originalGain.gain.value = 0
    this.correctedGain.gain.value = 0
    this.originalGain.connect(ctx.destination)
    this.correctedGain.connect(ctx.destination)
  }

  // Duração de referência = áudio corrigido (sempre 44.1 kHz).
  get duration() {
    return this.correctedBuffer.duration
  }

  get playing() {
    return this.isPlaying
  }

  get track() {
    return this.activeTrack
  }

  get matchEnabled() {
    return this.loudnessMatch
  }

  // Posição atual em segundos.
  position(): number {
    if (!this.isPlaying) return this.pauseOffset
    return Math.min(this.duration, this.ctx.currentTime - this.startTime)
  }

  private matchGains() {
    return this.loudnessMatch
      ? computeMatchGains(this.originalLufs, this.correctedLufs)
      : { original: 1, corrected: 1 }
  }

  private applyGains(ramp = 0.015) {
    const now = this.ctx.currentTime
    const g = this.matchGains()
    const orig = this.activeTrack === 'original' ? g.original : 0
    const corr = this.activeTrack === 'corrected' ? g.corrected : 0
    this.originalGain.gain.setTargetAtTime(orig, now, ramp)
    this.correctedGain.gain.setTargetAtTime(corr, now, ramp)
  }

  switchTo(track: Track) {
    this.activeTrack = track
    this.applyGains()
  }

  setLoudnessMatch(on: boolean) {
    this.loudnessMatch = on
    if (this.isPlaying) this.applyGains()
  }

  async play(offset = this.pauseOffset) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.stopSources()

    this.originalSource = this.ctx.createBufferSource()
    this.correctedSource = this.ctx.createBufferSource()
    this.originalSource.buffer = this.originalBuffer
    this.correctedSource.buffer = this.correctedBuffer
    this.originalSource.connect(this.originalGain)
    this.correctedSource.connect(this.correctedGain)

    this.correctedSource.onended = () => {
      // Só dispara o fim quando chegou ao término natural, não em seek/pause.
      if (this.isPlaying && this.position() >= this.duration - 0.05) {
        this.isPlaying = false
        this.pauseOffset = 0
        this.onEnded?.()
      }
    }

    const startAt = this.ctx.currentTime + 0.05
    this.originalSource.start(startAt, offset)
    this.correctedSource.start(startAt, offset)
    this.startTime = startAt - offset
    this.pauseOffset = offset
    this.isPlaying = true
    this.applyGains(0)
  }

  pause() {
    if (!this.isPlaying) return
    this.pauseOffset = this.position()
    this.isPlaying = false
    this.stopSources()
  }

  async seek(offset: number) {
    const clamped = Math.max(0, Math.min(this.duration, offset))
    if (this.isPlaying) {
      await this.play(clamped)
    } else {
      this.pauseOffset = clamped
    }
  }

  private stopSources() {
    for (const s of [this.originalSource, this.correctedSource]) {
      if (s) {
        s.onended = null
        try { s.stop() } catch { /* já parado */ }
        s.disconnect()
      }
    }
    this.originalSource = null
    this.correctedSource = null
  }

  dispose() {
    this.stopSources()
    this.originalGain.disconnect()
    this.correctedGain.disconnect()
  }
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

interface Props {
  originalFile: File
  correctedBlob: Blob
  correctedBuffer: AudioBuffer
  originalLufs: number
  correctedLufs: number
}

export function ABComparePlayer({
  originalFile, correctedBlob, correctedBuffer, originalLufs, correctedLufs,
}: Props) {
  const playerRef = useRef<ABPlayer | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)

  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [track, setTrack] = useState<Track>('corrected')
  const [match, setMatch] = useState(true)
  const [pos, setPos] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    let cancelled = false
    const ctx = new AudioContext()
    ctxRef.current = ctx

    ;(async () => {
      try {
        const originalArrayBuffer = await originalFile.arrayBuffer()
        // Reusa o buffer corrigido já decodificado; só decodifica o original.
        const originalBuffer = await ctx.decodeAudioData(originalArrayBuffer.slice(0))
        if (cancelled) return
        const player = new ABPlayer(ctx, originalBuffer, correctedBuffer, originalLufs, correctedLufs)
        player.onEnded = () => { setPlaying(false); setPos(0) }
        playerRef.current = player
        setDuration(player.duration)
        setReady(true)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      playerRef.current?.dispose()
      playerRef.current = null
      ctx.close().catch(() => {})
    }
    // correctedBlob é intencionalmente ignorado: o buffer já vem decodificado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalFile, correctedBuffer, originalLufs, correctedLufs])

  // Loop de atualização da posição enquanto toca.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current)
      return
    }
    const tick = () => {
      const p = playerRef.current
      if (p) setPos(p.position())
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  if (failed) {
    return (
      <div className="rounded-lg border border-muted bg-surface px-4 py-3">
        <p className="text-xs text-dim font-mono">
          Pré-visualização de áudio indisponível para este formato.
        </p>
      </div>
    )
  }

  async function togglePlay() {
    const p = playerRef.current
    if (!p) return
    if (p.playing) {
      p.pause()
      setPlaying(false)
      setPos(p.position())
    } else {
      await p.play()
      setPlaying(true)
    }
  }

  function selectTrack(t: Track) {
    setTrack(t)
    playerRef.current?.switchTo(t)
  }

  function toggleMatch() {
    const next = !match
    setMatch(next)
    playerRef.current?.setLoudnessMatch(next)
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const p = playerRef.current
    if (!p || duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const target = ratio * duration
    p.seek(target)
    setPos(target)
  }

  const progress = duration > 0 ? (pos / duration) * 100 : 0

  return (
    <div className="rounded-lg border border-muted bg-surface p-5 space-y-5">
      <p className="text-xs text-dim uppercase tracking-widest font-mono">Compare o resultado</p>

      {/* Toggle A/B — elemento mais proeminente */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Selecionar faixa para audição">
        {([['original', 'Original'], ['corrected', 'Corrigido']] as [Track, string][]).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => selectTrack(t)}
            disabled={!ready}
            aria-pressed={track === t}
            className={[
              'py-3 rounded text-sm font-bold tracking-wide border transition-colors disabled:opacity-30 disabled:pointer-events-none',
              track === t
                ? 'bg-brass-faint border-brass text-brass'
                : 'bg-canvas border-muted text-dim hover:border-faint hover:text-fg',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Barra de progresso clicável */}
      <div
        role="slider"
        aria-label="Posição da reprodução"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(pos)}
        tabIndex={ready ? 0 : -1}
        onClick={handleSeek}
        onKeyDown={(e) => {
          const p = playerRef.current
          if (!p) return
          if (e.key === 'ArrowRight') { e.preventDefault(); p.seek(p.position() + 5); setPos(p.position()) }
          if (e.key === 'ArrowLeft')  { e.preventDefault(); p.seek(p.position() - 5); setPos(p.position()) }
        }}
        className="group h-2 rounded-full bg-canvas border border-muted cursor-pointer relative"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-brass transition-[width] duration-75"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Controles */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!ready}
          aria-label={playing ? 'Pausar' : 'Reproduzir'}
          className="w-11 h-11 rounded-full bg-brass text-canvas flex items-center justify-center hover:bg-brass-dim transition-colors disabled:opacity-30 disabled:pointer-events-none shrink-0"
        >
          <span aria-hidden className="text-base leading-none">{playing ? '❚❚' : '▶'}</span>
        </button>
        <span className="font-mono text-xs text-dim tabular-nums">
          {fmtTime(pos)} / {fmtTime(duration)}
        </span>
      </div>

      {/* Loudness match */}
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <button
          type="button"
          role="switch"
          aria-checked={match}
          onClick={toggleMatch}
          disabled={!ready}
          className={[
            'mt-0.5 w-9 h-5 rounded-full border transition-colors relative shrink-0 disabled:opacity-30',
            match ? 'bg-brass-faint border-brass' : 'bg-canvas border-muted',
          ].join(' ')}
        >
          <span
            aria-hidden
            className={[
              'absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all',
              match ? 'left-[1.05rem] bg-brass' : 'left-0.5 bg-faint',
            ].join(' ')}
          />
        </button>
        <span className="text-xs">
          <span className="text-fg font-medium">Equalizar volume (comparação justa)</span>
          <span className="block text-dim font-mono mt-0.5">
            Iguala o volume percebido para você comparar a qualidade, não o volume.
          </span>
        </span>
      </label>
    </div>
  )
}
