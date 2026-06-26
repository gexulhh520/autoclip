import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CaretRightOutlined,
  PauseOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from '@ant-design/icons'
import type { LibraryAsset } from '../../services/libraryApi'
import { clampTrimRange, formatTimecode } from '../../../utils/timecodeFormat'
import './LibraryAssetTrimModal.css'

const MIN_TRIM_SPAN = 0.1
const SEEK_STEP = 0.1
const SEEK_STEP_COARSE = 1.0
const NUDGE_STEP = 0.05

export interface LibraryAssetTrimModalProps {
  open: boolean
  asset: LibraryAsset | null
  videoUrl: string
  confirming?: boolean
  eyebrow?: string
  confirmLabel?: string
  hint?: string
  targetDurationSec?: number | null
  initialTrim?: { inSec: number; outSec: number } | null
  onClose: () => void
  onConfirm: (trimInSec: number, trimOutSec: number) => void | Promise<void>
}

type DragTarget = 'in' | 'out' | 'playhead' | null

function defaultRange(durationSec: number): { inSec: number; outSec: number } {
  if (durationSec <= 0) return { inSec: 0, outSec: MIN_TRIM_SPAN }
  const outSec = durationSec > 60 ? Math.min(30, durationSec) : durationSec
  return clampTrimRange(durationSec, 0, outSec, MIN_TRIM_SPAN)
}

const LibraryAssetTrimModal: React.FC<LibraryAssetTrimModalProps> = ({
  open,
  asset,
  videoUrl,
  confirming = false,
  eyebrow = '裁剪后添加',
  confirmLabel = '确认添加到时间线',
  hint,
  targetDurationSec = null,
  initialTrim = null,
  onClose,
  onConfirm,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragTarget>(null)

  const [durationSec, setDurationSec] = useState(0)
  const [inSec, setInSec] = useState(0)
  const [outSec, setOutSec] = useState(MIN_TRIM_SPAN)
  const [playheadSec, setPlayheadSec] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!open) return
    setDurationSec(0)
    setPlaying(false)
    const durationHint = asset?.duration_sec ?? 0
    if (initialTrim && initialTrim.outSec > initialTrim.inSec + 0.05) {
      const clamped = clampTrimRange(
        durationHint > 0 ? durationHint : Math.max(initialTrim.outSec, 1),
        initialTrim.inSec,
        initialTrim.outSec,
        MIN_TRIM_SPAN
      )
      setInSec(clamped.inSec)
      setOutSec(clamped.outSec)
      setPlayheadSec(clamped.inSec)
      return
    }
    const initial = defaultRange(durationHint)
    setInSec(initial.inSec)
    setOutSec(initial.outSec)
    setPlayheadSec(initial.inSec)
  }, [open, asset?.id, asset?.duration_sec, initialTrim?.inSec, initialTrim?.outSec])

  const selectionSpan = useMemo(() => Math.max(MIN_TRIM_SPAN, outSec - inSec), [inSec, outSec])

  const applyRange = useCallback(
    (nextIn: number, nextOut: number) => {
      const duration = durationSec > 0 ? durationSec : Math.max(nextOut, asset?.duration_sec ?? 0)
      const clamped = clampTrimRange(duration, nextIn, nextOut, MIN_TRIM_SPAN)
      setInSec(clamped.inSec)
      setOutSec(clamped.outSec)
      setPlayheadSec((prev) =>
        Math.min(clamped.outSec - 0.01, Math.max(clamped.inSec, prev))
      )
    },
    [durationSec, asset?.duration_sec]
  )

  const seekVideo = useCallback((sec: number) => {
    const video = videoRef.current
    if (!video) return
    const clamped = Math.max(0, Math.min(durationSec || video.duration || sec, sec))
    video.currentTime = clamped
    setPlayheadSec(clamped)
  }, [durationSec])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      if (video.currentTime < inSec || video.currentTime >= outSec - 0.02) {
        video.currentTime = inSec
        setPlayheadSec(inSec)
      }
      void video.play()
      setPlaying(true)
    } else {
      video.pause()
      setPlaying(false)
    }
  }, [inSec, outSec])

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    const duration = video.duration
    setDurationSec(duration)
    if (initialTrim && initialTrim.outSec > initialTrim.inSec + 0.05) {
      const clamped = clampTrimRange(duration, initialTrim.inSec, initialTrim.outSec, MIN_TRIM_SPAN)
      setInSec(clamped.inSec)
      setOutSec(clamped.outSec)
      setPlayheadSec(clamped.inSec)
      video.currentTime = clamped.inSec
      return
    }
    const initial = defaultRange(duration)
    setInSec(initial.inSec)
    setOutSec(initial.outSec)
    setPlayheadSec(initial.inSec)
    video.currentTime = initial.inSec
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (!video) return
    const t = video.currentTime
    setPlayheadSec(t)
    if (playing && t >= outSec - 0.03) {
      video.pause()
      video.currentTime = inSec
      setPlayheadSec(inSec)
      setPlaying(false)
    }
  }

  const secFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      const duration = durationSec || asset?.duration_sec || 0
      if (!track || duration <= 0) return 0
      const rect = track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return ratio * duration
    },
    [durationSec, asset?.duration_sec]
  )

  useEffect(() => {
    if (!open) return

    const onPointerMove = (event: PointerEvent) => {
      const target = dragRef.current
      if (!target) return
      const sec = secFromClientX(event.clientX)
      if (target === 'in') {
        applyRange(sec, outSec)
      } else if (target === 'out') {
        applyRange(inSec, sec)
      } else if (target === 'playhead') {
        const clamped = Math.max(inSec, Math.min(outSec - 0.01, sec))
        seekVideo(clamped)
      }
    }

    const onPointerUp = () => {
      dragRef.current = null
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [open, applyRange, inSec, outSec, secFromClientX, seekVideo])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return

      const step = event.shiftKey ? SEEK_STEP_COARSE : SEEK_STEP
      const nudge = event.shiftKey ? NUDGE_STEP * 4 : NUDGE_STEP

      switch (event.key) {
        case ' ':
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          event.preventDefault()
          if (event.altKey) {
            applyRange(inSec - nudge, outSec)
          } else if (event.ctrlKey || event.metaKey) {
            applyRange(inSec, outSec - nudge)
          } else {
            seekVideo(playheadSec - step)
          }
          break
        case 'ArrowRight':
          event.preventDefault()
          if (event.altKey) {
            applyRange(inSec + nudge, outSec)
          } else if (event.ctrlKey || event.metaKey) {
            applyRange(inSec, outSec + nudge)
          } else {
            seekVideo(playheadSec + step)
          }
          break
        case 'i':
        case 'I':
        case '[':
          event.preventDefault()
          applyRange(playheadSec, outSec)
          break
        case 'o':
        case 'O':
        case ']':
          event.preventDefault()
          applyRange(inSec, playheadSec)
          break
        case 'Escape':
          event.preventDefault()
          onClose()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, applyRange, inSec, outSec, playheadSec, seekVideo, togglePlay, onClose])

  if (!open || !asset) return null

  const duration = durationSec || asset.duration_sec || 0
  const pct = (sec: number) => (duration > 0 ? (sec / duration) * 100 : 0)

  const parseInput = (raw: string, fallback: number) => {
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) ? value : fallback
  }

  return createPortal(
    <div className="library-trim-modal" role="presentation" onClick={onClose}>
      <div
        className="library-trim-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-trim-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="library-trim-modal__head">
          <div>
            <p className="library-trim-modal__eyebrow">{eyebrow}</p>
            <h2 id="library-trim-modal-title" className="library-trim-modal__title">
              {asset.title || asset.id}
            </h2>
          </div>
          <button type="button" className="library-trim-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="library-trim-modal__preview">
          <video
            ref={videoRef}
            className="library-trim-modal__video"
            src={videoUrl}
            playsInline
            preload="metadata"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onClick={() => togglePlay()}
          />
          <button
            type="button"
            className="library-trim-modal__play"
            onClick={() => togglePlay()}
            aria-label={playing ? '暂停' : '播放选段'}
          >
            {playing ? <PauseOutlined /> : <CaretRightOutlined />}
          </button>
        </div>

        <div
          ref={trackRef}
          className="library-trim-modal__track"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('.library-trim-modal__handle')) return
            const sec = secFromClientX(event.clientX)
            const clamped = Math.max(inSec, Math.min(outSec, sec))
            dragRef.current = 'playhead'
            seekVideo(clamped)
          }}
        >
          <div className="library-trim-modal__track-bg" />
          <div
            className="library-trim-modal__track-range"
            style={{ left: `${pct(inSec)}%`, width: `${pct(outSec) - pct(inSec)}%` }}
          />
          <div
            className="library-trim-modal__playhead"
            style={{ left: `${pct(playheadSec)}%` }}
          />
          <button
            type="button"
            className="library-trim-modal__handle library-trim-modal__handle--in"
            style={{ left: `${pct(inSec)}%` }}
            aria-label="入点"
            onPointerDown={(event) => {
              event.stopPropagation()
              dragRef.current = 'in'
            }}
          />
          <button
            type="button"
            className="library-trim-modal__handle library-trim-modal__handle--out"
            style={{ left: `${pct(outSec)}%` }}
            aria-label="出点"
            onPointerDown={(event) => {
              event.stopPropagation()
              dragRef.current = 'out'
            }}
          />
        </div>

        <div className="library-trim-modal__fields">
          <label className="library-trim-modal__field">
            <span>入点 (s)</span>
            <div className="library-trim-modal__stepper">
              <button
                type="button"
                aria-label="入点减 0.05 秒"
                onClick={() => applyRange(inSec - NUDGE_STEP, outSec)}
              >
                <StepBackwardOutlined />
              </button>
              <input
                type="number"
                min={0}
                step={0.05}
                value={Number(inSec.toFixed(2))}
                onChange={(event) => applyRange(parseInput(event.target.value, inSec), outSec)}
              />
              <button
                type="button"
                aria-label="入点加 0.05 秒"
                onClick={() => applyRange(inSec + NUDGE_STEP, outSec)}
              >
                <StepForwardOutlined />
              </button>
            </div>
          </label>
          <label className="library-trim-modal__field">
            <span>出点 (s)</span>
            <div className="library-trim-modal__stepper">
              <button
                type="button"
                aria-label="出点减 0.05 秒"
                onClick={() => applyRange(inSec, outSec - NUDGE_STEP)}
              >
                <StepBackwardOutlined />
              </button>
              <input
                type="number"
                min={MIN_TRIM_SPAN}
                step={0.05}
                value={Number(outSec.toFixed(2))}
                onChange={(event) => applyRange(inSec, parseInput(event.target.value, outSec))}
              />
              <button
                type="button"
                aria-label="出点加 0.05 秒"
                onClick={() => applyRange(inSec, outSec + NUDGE_STEP)}
              >
                <StepForwardOutlined />
              </button>
            </div>
          </label>
          <div className="library-trim-modal__meta">
            <span className="library-trim-modal__meta-label">选段</span>
            <span className="library-trim-modal__meta-value">
              {formatTimecode(selectionSpan)} / {formatTimecode(duration || 0)}
              {targetDurationSec != null && targetDurationSec > 0
                ? ` · 口播 ${formatTimecode(targetDurationSec)}`
                : ''}
            </span>
          </div>
        </div>

        <p className="library-trim-modal__hint">
          {hint ??
            '空格播放选段 · ←→ 移动播放头 · I / [ 设入点 · O / ] 设出点 · Alt+←→ 微调入点 · Ctrl+←→ 微调出点'}
          {targetDurationSec != null && targetDurationSec > 0
            ? ' · 确认后将按口播时长自动对齐'
            : ''}
        </p>

        <footer className="library-trim-modal__footer">
          <button type="button" className="library-trim-modal__btn library-trim-modal__btn--ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="library-trim-modal__btn library-trim-modal__btn--primary"
            disabled={confirming || duration <= 0 || outSec <= inSec + 0.09}
            onClick={() => void onConfirm(inSec, outSec)}
          >
            {confirming ? '处理中…' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

export default LibraryAssetTrimModal
