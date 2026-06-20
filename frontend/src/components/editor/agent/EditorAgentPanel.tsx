import React, { useCallback, useEffect, useRef, useState } from 'react'
import { editorAgentApi } from '../../../services/editorAgentApi'
import type { LayoutAnalysis, LayoutReference } from '../../../types/editorAgent'
import { layoutReferenceStorageKey } from '../../../types/editorAgent'
import './EditorAgentPanel.css'

interface EditorAgentPanelProps {
  projectId: string
  sessionId: string
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

const EditorAgentPanel: React.FC<EditorAgentPanelProps> = ({ projectId, sessionId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [prompt, setPrompt] = useState('请分析参考图中的文字排版与画面构图。')
  const [summary, setSummary] = useState('')
  const [layout, setLayout] = useState<LayoutAnalysis | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const storageKey = layoutReferenceStorageKey(sessionId)

  const persistReference = useCallback(
    (analysis: LayoutAnalysis, analysisSummary: string, image: string, userPrompt: string) => {
      const payload: LayoutReference = {
        imageDataUrl: image,
        prompt: userPrompt,
        analysis,
        summary: analysisSummary,
        analyzedAt: new Date().toISOString(),
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(payload))
      } catch {
        // localStorage 满或不可用时忽略
      }
    },
    [storageKey]
  )

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const saved = JSON.parse(raw) as LayoutReference
      if (saved.imageDataUrl) setImageDataUrl(saved.imageDataUrl)
      if (saved.prompt) setPrompt(saved.prompt)
      if (saved.analysis) setLayout(saved.analysis)
      if (saved.summary) setSummary(saved.summary)
    } catch {
      localStorage.removeItem(storageKey)
    }
  }, [storageKey])

  const handleImageFile = async (file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    setError('')
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setImageDataUrl(dataUrl)
    } catch {
      setError('读取图片失败')
    }
  }

  const handleAnalyze = async () => {
    if (!imageDataUrl) {
      setError('请先上传参考图')
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await editorAgentApi.analyzeLayout(projectId, sessionId, {
        image_base64: imageDataUrl,
        prompt: prompt.trim(),
      })
      setLayout(response.layout)
      setSummary(response.summary)
      persistReference(response.layout, response.summary, imageDataUrl, prompt.trim())
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? String((err as { response?: { data?: { detail?: string } } }).response?.data?.detail || '分析失败')
          : err instanceof Error
            ? err.message
            : '分析失败'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleCopyJson = async () => {
    if (!layout) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(layout, null, 2))
    } catch {
      setError('复制失败')
    }
  }

  if (collapsed) {
    return (
      <aside className="editor-agent-panel is-collapsed">
        <div className="editor-agent-panel__header">
          <h2 className="editor-agent-panel__title">AI 剪辑</h2>
          <button
            type="button"
            className="editor-agent-panel__toggle"
            onClick={() => setCollapsed(false)}
          >
            展开
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="editor-agent-panel">
      <div className="editor-agent-panel__header">
        <h2 className="editor-agent-panel__title">AI 剪辑 · 排版分析</h2>
        <button
          type="button"
          className="editor-agent-panel__toggle"
          onClick={() => setCollapsed(true)}
        >
          收起
        </button>
      </div>

      <div className="editor-agent-panel__body">
        <p className="editor-agent-panel__hint">
          上传参考图，由本地 Ollama（gemma4:12b）分析排版。确认前不会修改时间线。
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="editor-agent-panel__file-input"
          onChange={(event) => void handleImageFile(event.target.files?.[0])}
        />

        <div
          className={`editor-agent-panel__dropzone${imageDataUrl ? ' has-image' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click()
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void handleImageFile(event.dataTransfer.files?.[0])
          }}
        >
          {imageDataUrl ? (
            <img src={imageDataUrl} alt="参考图预览" className="editor-agent-panel__preview" />
          ) : (
            <>
              <span>点击或拖拽上传参考图</span>
              <span>支持 PNG / JPG / WebP</span>
            </>
          )}
        </div>

        <textarea
          className="editor-agent-panel__textarea"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="补充说明，例如：主标题在顶部居中，底部有半透明说明条"
        />

        <div className="editor-agent-panel__actions">
          <button
            type="button"
            className="editor-agent-panel__btn editor-agent-panel__btn--primary"
            disabled={loading}
            onClick={() => void handleAnalyze()}
          >
            {loading ? '分析中…' : '分析排版'}
          </button>
          {layout ? (
            <button type="button" className="editor-agent-panel__btn" onClick={() => void handleCopyJson()}>
              复制 JSON
            </button>
          ) : null}
        </div>

        {error ? <p className="editor-agent-panel__error">{error}</p> : null}

        {summary ? <p className="editor-agent-panel__summary">{summary}</p> : null}

        {layout ? (
          <pre className="editor-agent-panel__json">{JSON.stringify(layout, null, 2)}</pre>
        ) : null}
      </div>
    </aside>
  )
}

export default EditorAgentPanel
