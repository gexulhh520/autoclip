import React, { useEffect, useMemo, useRef } from 'react'
import { Headphones, Volume2 } from 'lucide-react'
import {
  DEFAULT_EDGE_TTS_VOICE,
  EDGE_TTS_VOICES_ZH,
  findEdgeTtsVoice,
  formatEdgeTtsVoiceLabel,
  getEdgeTtsVoiceGroups,
  resolveEdgeTtsVoiceId,
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
  /** 仅禁用「朗读」按钮（口播字幕等已有 TTS 的场景） */
  synthesizeDisabled?: boolean
  synthesizeDisabledReason?: string
  voiceDisabled?: boolean
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
  synthesizeDisabled = false,
  synthesizeDisabledReason,
  voiceDisabled = false,
}) => {
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const previewObjectUrlRef = useRef<string | null>(null)
  const trimmed = text.trim()
  const canPreview = !disabled && trimmed.length > 0
  const canSynthesize = !disabled && !synthesizeDisabled && trimmed.length > 0
  const voiceGroups = useMemo(() => getEdgeTtsVoiceGroups(), [])
  const selectedVoice = useMemo(
    () => findEdgeTtsVoice(voice) ?? findEdgeTtsVoice(DEFAULT_EDGE_TTS_VOICE),
    [voice]
  )
  const resolvedVoice = resolveEdgeTtsVoiceId(voice)

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
    if (!canPreview || previewLoading || synthesizeLoading) return
    try {
      const blob = await onPreview()
      if (!blob) return
      await playBlob(blob)
    } catch {
      // 错误由上层 message 处理
    }
  }

  const handleSynthesize = async () => {
    if (!canSynthesize || previewLoading || synthesizeLoading) return
    try {
      const result = await onSynthesize()
      if (!result?.audioUrl) return
      await playAudioUrl(result.audioUrl)
    } catch {
      // 错误由上层 message 处理
    }
  }

  return (
    <div className="editor-inspector-section editor-tts-panel">
      <div className="editor-inspector-label">朗读</div>
      <p className="editor-inspector-muted" style={{ marginTop: 4, marginBottom: 10 }}>
        {synthesizeDisabled
          ? '预读播放本条口播音频；重新配音请在口播面板执行'
          : '预读仅试听；朗读会生成音频并加入时间线'}
      </p>
      <select
        className="editor-select editor-tts-panel__voice"
        value={resolvedVoice}
        disabled={voiceDisabled || previewLoading || synthesizeLoading || disabled}
        onChange={(event) => onVoiceChange(event.target.value)}
        aria-label="朗读音色"
      >
        {voiceGroups.map((group) => (
          <optgroup key={group.id} label={group.label}>
            {group.voices.map((item) => (
              <option key={item.id} value={item.id}>
                {formatEdgeTtsVoiceLabel(item)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {selectedVoice ? (
        <p className="editor-inspector-muted editor-tts-panel__hint">{selectedVoice.hint}</p>
      ) : null}
      <div className="editor-tts-panel__actions">
        <button
          type="button"
          className="editor-tts-panel__btn editor-tts-panel__btn--secondary"
          disabled={!canPreview || previewLoading || synthesizeLoading}
          onClick={() => void handlePreview()}
          title={disabledReason}
        >
          <Headphones size={15} strokeWidth={1.75} />
          {previewLoading ? '预读中…' : '预读'}
        </button>
        <button
          type="button"
          className="editor-tts-panel__btn"
          disabled={!canSynthesize || previewLoading || synthesizeLoading}
          onClick={() => void handleSynthesize()}
          title={synthesizeDisabledReason ?? disabledReason}
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
      {synthesizeDisabled && synthesizeDisabledReason ? (
        <p className="editor-inspector-muted" style={{ marginTop: 8 }}>
          {synthesizeDisabledReason}
        </p>
      ) : null}
      {disabled && disabledReason && !synthesizeDisabled ? (
        <p className="editor-inspector-muted" style={{ marginTop: 8 }}>
          {disabledReason}
        </p>
      ) : null}
    </div>
  )
}

export default TextToSpeechPanel
