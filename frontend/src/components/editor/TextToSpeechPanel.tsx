import React, { useEffect, useMemo, useRef } from 'react'
import { Headphones, Volume2 } from 'lucide-react'
import {
  DEFAULT_EDGE_TTS_VOICE,
  EDGE_TTS_VOICES_ZH,
  EDGE_TTS_VOICES_ZH_FEMALE,
  EDGE_TTS_VOICES_ZH_MALE,
  findEdgeTtsVoice,
  formatEdgeTtsVoiceLabel,
} from '../../editor/tts/edgeTtsVoices'

export { DEFAULT_EDGE_TTS_VOICE, EDGE_TTS_VOICES_ZH as EDGE_TTS_VOICES }

interface TextToSpeechPanelProps {
  text: string
  previewLoading?: boolean
  synthesizeLoading?: boolean
  voice: string
  onVoiceChange: (voice: string) => void
  onPreview: () => Promise<Blob | null>
  onSynthesize: () => Promise<{ audioUrl: string } | null>
  disabled?: boolean
  disabledReason?: string
}

const TextToSpeechPanel: React.FC<TextToSpeechPanelProps> = ({
  text,
  previewLoading = false,
  synthesizeLoading = false,
  voice,
  onVoiceChange,
  onPreview,
  onSynthesize,
  disabled = false,
  disabledReason,
}) => {
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const previewObjectUrlRef = useRef<string | null>(null)
  const trimmed = text.trim()
  const busy = previewLoading || synthesizeLoading
  const canSpeak = !disabled && trimmed.length > 0
  const selectedVoice = useMemo(
    () => findEdgeTtsVoice(voice) ?? findEdgeTtsVoice(DEFAULT_EDGE_TTS_VOICE),
    [voice]
  )

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current)
        previewObjectUrlRef.current = null
      }
    }
  }, [])

  const playAudioUrl = async (audioUrl: string) => {
    if (!previewRef.current) {
      previewRef.current = new Audio(audioUrl)
    } else {
      previewRef.current.src = audioUrl
    }
    previewRef.current.currentTime = 0
    await previewRef.current.play()
  }

  const playBlob = async (blob: Blob) => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current)
    }
    const objectUrl = URL.createObjectURL(blob)
    previewObjectUrlRef.current = objectUrl
    await playAudioUrl(objectUrl)
  }

  const handlePreview = async () => {
    if (!canSpeak || busy) return
    try {
      const blob = await onPreview()
      if (!blob) return
      await playBlob(blob)
    } catch {
      // 错误由上层 message 处理
    }
  }

  const handleSynthesize = async () => {
    if (!canSpeak || busy) return
    try {
      const result = await onSynthesize()
      if (!result?.audioUrl) return
      await playAudioUrl(result.audioUrl)
    } catch {
      // 错误由上层 message 处理
    }
  }

  const renderVoiceOptions = (items: typeof EDGE_TTS_VOICES_ZH) =>
    items.map((item) => (
      <option key={item.id} value={item.id}>
        {formatEdgeTtsVoiceLabel(item)}
      </option>
    ))

  return (
    <div className="editor-inspector-section editor-tts-panel">
      <div className="editor-inspector-label">朗读</div>
      <p className="editor-inspector-muted" style={{ marginTop: 4, marginBottom: 10 }}>
        预读仅试听；朗读会生成音频并加入时间线
      </p>
      <select
        className="editor-select editor-tts-panel__voice"
        value={voice}
        disabled={busy || disabled}
        onChange={(event) => onVoiceChange(event.target.value)}
        aria-label="朗读音色"
      >
        <optgroup label="女声">
          {renderVoiceOptions(EDGE_TTS_VOICES_ZH_FEMALE)}
        </optgroup>
        <optgroup label="男声">
          {renderVoiceOptions(EDGE_TTS_VOICES_ZH_MALE)}
        </optgroup>
      </select>
      {selectedVoice ? (
        <p className="editor-inspector-muted editor-tts-panel__hint">{selectedVoice.hint}</p>
      ) : null}
      <div className="editor-tts-panel__actions">
        <button
          type="button"
          className="editor-tts-panel__btn editor-tts-panel__btn--secondary"
          disabled={!canSpeak || busy}
          onClick={() => void handlePreview()}
          title={disabledReason}
        >
          <Headphones size={15} strokeWidth={1.75} />
          {previewLoading ? '预读中…' : '预读'}
        </button>
        <button
          type="button"
          className="editor-tts-panel__btn"
          disabled={!canSpeak || busy}
          onClick={() => void handleSynthesize()}
          title={disabledReason}
        >
          <Volume2 size={15} strokeWidth={1.75} />
          {synthesizeLoading ? '生成中…' : '朗读'}
        </button>
      </div>
      {!trimmed && !disabled ? (
        <p className="editor-inspector-muted" style={{ marginTop: 8 }}>
          请先输入文本内容
        </p>
      ) : null}
      {disabled && disabledReason ? (
        <p className="editor-inspector-muted" style={{ marginTop: 8 }}>
          {disabledReason}
        </p>
      ) : null}
    </div>
  )
}

export default TextToSpeechPanel
