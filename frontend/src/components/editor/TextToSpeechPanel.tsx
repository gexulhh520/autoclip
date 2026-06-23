import React, { useRef } from 'react'
import { Volume2 } from 'lucide-react'

export const EDGE_TTS_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '女声' },
  { id: 'zh-CN-YunxiNeural', label: '男声' },
] as const

interface TextToSpeechPanelProps {
  text: string
  loading?: boolean
  voice: string
  onVoiceChange: (voice: string) => void
  onSynthesize: () => Promise<{ audioUrl: string } | null>
  disabled?: boolean
  disabledReason?: string
}

const TextToSpeechPanel: React.FC<TextToSpeechPanelProps> = ({
  text,
  loading = false,
  voice,
  onVoiceChange,
  onSynthesize,
  disabled = false,
  disabledReason,
}) => {
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const trimmed = text.trim()
  const canSpeak = !disabled && trimmed.length > 0

  const handleClick = async () => {
    if (!canSpeak || loading) return
    try {
      const result = await onSynthesize()
      if (!result?.audioUrl) return
      if (!previewRef.current) {
        previewRef.current = new Audio(result.audioUrl)
      } else {
        previewRef.current.src = result.audioUrl
      }
      previewRef.current.currentTime = 0
      await previewRef.current.play()
    } catch {
      // 错误由上层 message 处理
    }
  }

  return (
    <div className="editor-inspector-section editor-tts-panel">
      <div className="editor-inspector-label">朗读</div>
      <p className="editor-inspector-muted" style={{ marginTop: 4, marginBottom: 10 }}>
        使用 Edge 神经语音合成，生成后自动加入时间线并预览
      </p>
      <div className="editor-tts-panel__row">
        <select
          className="editor-select editor-tts-panel__voice"
          value={voice}
          disabled={loading || disabled}
          onChange={(event) => onVoiceChange(event.target.value)}
          aria-label="朗读音色"
        >
          {EDGE_TTS_VOICES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="editor-tts-panel__btn"
          disabled={!canSpeak || loading}
          onClick={() => void handleClick()}
          title={disabledReason}
        >
          <Volume2 size={15} strokeWidth={1.75} />
          {loading ? '生成中…' : '朗读'}
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
