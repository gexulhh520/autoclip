import React, { useCallback, useEffect, useRef, useState } from 'react'
import { confirmExecutePlan, planApplyLayout } from '../../../editor/agent/planApplyLayout'
import { formatToolCallSummary } from '../../../editor/agent/toolRegistry'
import { editorAgentApi } from '../../../services/editorAgentApi'
import type {
  AgentPanelMode,
  AgentToolCall,
  LayoutAnalysis,
  LayoutReference,
  PendingAgentPlan,
} from '../../../types/editorAgent'
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
  const [mode, setMode] = useState<AgentPanelMode>('analyze_only')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [prompt, setPrompt] = useState('仿照参考图的文字排版，用我当前草稿里的文案做类似排版。')
  const [summary, setSummary] = useState('')
  const [layout, setLayout] = useState<LayoutAnalysis | null>(null)
  const [pendingPlan, setPendingPlan] = useState<PendingAgentPlan | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)

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
        // ignore
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
    setPendingPlan(null)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setImageDataUrl(dataUrl)
    } catch {
      setError('读取图片失败')
    }
  }

  const runAnalyze = async (): Promise<LayoutAnalysis | null> => {
    if (!imageDataUrl) {
      setError('请先上传参考图')
      return null
    }
    const response = await editorAgentApi.analyzeLayout(projectId, sessionId, {
      image_base64: imageDataUrl,
      prompt: prompt.trim(),
    })
    setLayout(response.layout)
    setSummary(response.summary)
    persistReference(response.layout, response.summary, imageDataUrl, prompt.trim())
    return response.layout
  }

  const handleAnalyze = async () => {
    setLoading(true)
    setError('')
    setPendingPlan(null)
    try {
      await runAnalyze()
    } catch (err: unknown) {
      setError(extractErrorMessage(err, '分析失败'))
    } finally {
      setLoading(false)
    }
  }

  const handlePlanApply = async () => {
    setLoading(true)
    setError('')
    setPendingPlan(null)
    try {
      let analysis = layout
      if (!analysis) {
        analysis = await runAnalyze()
      }
      if (!analysis) return

      const plan = await planApplyLayout({
        projectId,
        sessionId,
        layout: analysis,
        userPrompt: prompt.trim(),
      })
      if (plan.tool_calls.length === 0) {
        setError('未生成可执行操作')
        return
      }
      setPendingPlan(plan)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, '生成执行计划失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmExecute = async () => {
    if (!pendingPlan?.tool_calls.length) return
    setExecuting(true)
    setError('')
    try {
      const results = confirmExecutePlan(pendingPlan.tool_calls)
      const failed = results.find((item) => !item.ok)
      if (failed) {
        setError(failed.error ?? '部分操作失败')
      } else {
        setPendingPlan(null)
        setSummary('已应用到时间线，可预览并撤销。')
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, '执行失败'))
    } finally {
      setExecuting(false)
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

  const handlePrimaryAction = () => {
    if (mode === 'analyze_only') {
      void handleAnalyze()
    } else {
      void handlePlanApply()
    }
  }

  if (collapsed) {
    return (
      <aside className="editor-agent-panel is-collapsed">
        <div className="editor-agent-panel__header">
          <h2 className="editor-agent-panel__title">AI 剪辑</h2>
          <button type="button" className="editor-agent-panel__toggle" onClick={() => setCollapsed(false)}>
            展开
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="editor-agent-panel">
      <div className="editor-agent-panel__header">
        <h2 className="editor-agent-panel__title">AI 剪辑</h2>
        <button type="button" className="editor-agent-panel__toggle" onClick={() => setCollapsed(true)}>
          收起
        </button>
      </div>

      <div className="editor-agent-panel__body">
        <div className="editor-agent-panel__segmented">
          <button
            type="button"
            className={mode === 'analyze_only' ? 'is-active' : ''}
            onClick={() => setMode('analyze_only')}
          >
            仅分析
          </button>
          <button
            type="button"
            className={mode === 'analyze_and_apply' ? 'is-active' : ''}
            onClick={() => setMode('analyze_and_apply')}
          >
            分析并应用
          </button>
        </div>

        <p className="editor-agent-panel__hint">
          {mode === 'analyze_only'
            ? '上传参考图分析排版，确认前不会修改时间线。'
            : '仿照参考图排版，文案来自当前草稿；执行前会展示操作清单。'}
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
          placeholder="描述你的排版意图…"
        />

        <div className="editor-agent-panel__actions">
          <button
            type="button"
            className="editor-agent-panel__btn editor-agent-panel__btn--primary"
            disabled={loading || executing}
            onClick={handlePrimaryAction}
          >
            {loading
              ? mode === 'analyze_only'
                ? '分析中…'
                : '规划中…'
              : mode === 'analyze_only'
                ? '分析排版'
                : '生成应用计划'}
          </button>
          {layout ? (
            <button type="button" className="editor-agent-panel__btn" onClick={() => void handleCopyJson()}>
              复制 JSON
            </button>
          ) : null}
        </div>

        {pendingPlan ? (
          <div className="editor-agent-panel__plan">
            <p className="editor-agent-panel__plan-title">
              操作清单（{pendingPlan.source === 'llm' ? 'LLM' : '本地'} · {pendingPlan.tool_calls.length} 步）
            </p>
            <ul className="editor-agent-panel__plan-list">
              {pendingPlan.tool_calls.map((call, index) => (
                <PlanLine key={`${call.name}-${index}`} call={call} />
              ))}
            </ul>
            <div className="editor-agent-panel__actions">
              <button
                type="button"
                className="editor-agent-panel__btn editor-agent-panel__btn--primary"
                disabled={executing}
                onClick={() => void handleConfirmExecute()}
              >
                {executing ? '执行中…' : '确认执行'}
              </button>
              <button
                type="button"
                className="editor-agent-panel__btn"
                disabled={executing}
                onClick={() => setPendingPlan(null)}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="editor-agent-panel__error">{error}</p> : null}
        {summary ? <p className="editor-agent-panel__summary">{summary}</p> : null}
        {layout && mode === 'analyze_only' ? (
          <pre className="editor-agent-panel__json">{JSON.stringify(layout, null, 2)}</pre>
        ) : null}
      </div>
    </aside>
  )
}

const PlanLine: React.FC<{ call: AgentToolCall }> = ({ call }) => (
  <li>{formatToolCallSummary(call.name, call.arguments)}</li>
)

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    return String(
      (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || fallback
    )
  }
  return err instanceof Error ? err.message : fallback
}

export default EditorAgentPanel
