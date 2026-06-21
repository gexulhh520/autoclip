import React, { useCallback, useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { formatAgentDebugDetail, formatAgentDebugSummary } from '../../../editor/agent/formatAgentDebug'
import { confirmExecutePlan, continueAgentChatAfterApply, executeAgentTaskPlan, planApplyLayout } from '../../../editor/agent/planApplyLayout'
import { runAgentChat } from '../../../editor/agent/runAgentChat'
import { mergeExecutionLedger, buildExecutionRecords } from '../../../editor/agent/agentExecutionLedger'
import {
  applyMomentExtractToPool,
  applyMomentExtractToTimeline,
  formatMomentExportChoiceHint,
} from '../../../editor/agent/applyMomentExport'
import { formatToolCallSummary, isDangerousAgentTool } from '../../../editor/agent/toolRegistry'
import { editorAgentApi } from '../../../services/editorAgentApi'
import type {
  AgentChatTurn,
  AgentDebugTrace,
  AgentPanelMode,
  AgentToolCall,
  LayoutAnalysis,
  LayoutReference,
  AgentTaskPlan,
  PendingAgentPlan,
} from '../../../types/editorAgent'
import { agentChatStorageKey, agentExecutionLedgerStorageKey, layoutReferenceStorageKey } from '../../../types/editorAgent'
import { useEditSessionStore } from '../../../stores/useEditSessionStore'
import { useAgentPanelStore } from '../../../stores/useAgentPanelStore'
import { blockPlaybackRate } from '../../../utils/editTimeline'
import './EditorAgentPanel.css'
import { useFloatingPanelDrag } from './useFloatingPanelDrag'

const AGENT_PANEL_POS_KEY = 'autoclip:agent-panel-position'

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

const formatClipDuration = (durationSec: number): string => {
  if (durationSec >= 60) {
    const minutes = Math.floor(durationSec / 60)
    const seconds = durationSec % 60
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
  }
  return `${durationSec.toFixed(1)} 秒`
}

const blockVisibleDurationSec = (block: {
  trim: { in_sec: number; out_sec: number }
  playback_rate?: number
}): number => {
  const rate = blockPlaybackRate(block)
  return Math.max(0, block.trim.out_sec - block.trim.in_sec) / rate
}

const EditorAgentPanel: React.FC<EditorAgentPanelProps> = ({ projectId, sessionId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const session = useEditSessionStore((state) => state.session)
  const focusedBlockId = useAgentPanelStore(
    (state) => state.focusedBlockBySession[sessionId] ?? null
  )
  const focusRequest = useAgentPanelStore((state) => state.focusRequest)
  const clearFocusedBlock = useAgentPanelStore((state) => state.clearFocusedBlock)
  const lastMomentSearch = useAgentPanelStore(
    (state) => state.lastMomentSearchBySession[sessionId] ?? null
  )
  const clearLastMomentSearch = useAgentPanelStore((state) => state.clearLastMomentSearch)
  const focusedBlock =
    focusedBlockId != null
      ? session?.sequence.find((block) => block.id === focusedBlockId) ?? null
      : null
  const [collapsed, setCollapsed] = useState(false)
  const [mode, setMode] = useState<AgentPanelMode>('assistant')
  const [chatInput, setChatInput] = useState('')
  const [chatTurns, setChatTurns] = useState<AgentChatTurn[]>([])
  const chatTurnsRef = useRef<AgentChatTurn[]>([])
  useEffect(() => {
    chatTurnsRef.current = chatTurns
  }, [chatTurns])
  const [attachImage, setAttachImage] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [layoutPrompt, setLayoutPrompt] = useState('仿照参考图的文字排版，用当前草稿文案做类似排版。')
  const [summary, setSummary] = useState('')
  const [layout, setLayout] = useState<LayoutAnalysis | null>(null)
  const [pendingPlan, setPendingPlan] = useState<PendingAgentPlan | null>(null)
  const [agentTaskPlan, setAgentTaskPlan] = useState<AgentTaskPlan | null>(null)
  const [taskExecuting, setTaskExecuting] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [agentDebugTrace, setAgentDebugTrace] = useState<AgentDebugTrace | null>(null)
  const [showAgentDebug, setShowAgentDebug] = useState(false)
  const [exportingMoments, setExportingMoments] = useState(false)
  const [executionLedger, setExecutionLedger] = useState<string[]>([])
  const executionLedgerRef = useRef<string[]>([])
  useEffect(() => {
    executionLedgerRef.current = executionLedger
  }, [executionLedger])

  const { panelRef, panelStyle, dragging, onHeaderPointerDown } = useFloatingPanelDrag(AGENT_PANEL_POS_KEY)

  useEffect(() => {
    if (!focusRequest || focusRequest.sessionId !== sessionId) return
    setCollapsed(false)
    setMode('assistant')
  }, [focusRequest, sessionId])

  useEffect(() => {
    if (!focusedBlockId || !session) return
    const exists = session.sequence.some((block) => block.id === focusedBlockId)
    if (!exists) clearFocusedBlock(sessionId)
  }, [focusedBlockId, session, sessionId, clearFocusedBlock])

  const layoutStorageKey = layoutReferenceStorageKey(sessionId)
  const chatStorageKey = agentChatStorageKey(sessionId)
  const ledgerStorageKey = agentExecutionLedgerStorageKey(sessionId)

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
        localStorage.setItem(layoutStorageKey, JSON.stringify(payload))
      } catch {
        // ignore
      }
    },
    [layoutStorageKey]
  )

  useEffect(() => {
    try {
      const raw = localStorage.getItem(layoutStorageKey)
      if (!raw) return
      const saved = JSON.parse(raw) as LayoutReference
      if (saved.imageDataUrl) setImageDataUrl(saved.imageDataUrl)
      if (saved.prompt) setLayoutPrompt(saved.prompt)
      if (saved.analysis) setLayout(saved.analysis)
      if (saved.summary) setSummary(saved.summary)
    } catch {
      localStorage.removeItem(layoutStorageKey)
    }
  }, [layoutStorageKey])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(chatStorageKey)
      if (!raw) return
      const saved = JSON.parse(raw) as AgentChatTurn[]
      if (Array.isArray(saved)) setChatTurns(saved)
    } catch {
      localStorage.removeItem(chatStorageKey)
    }
  }, [chatStorageKey])

  useEffect(() => {
    try {
      localStorage.setItem(chatStorageKey, JSON.stringify(chatTurns.slice(-40)))
    } catch {
      // ignore
    }
  }, [chatTurns, chatStorageKey])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ledgerStorageKey)
      if (!raw) return
      const saved = JSON.parse(raw) as string[]
      if (Array.isArray(saved)) setExecutionLedger(saved)
    } catch {
      localStorage.removeItem(ledgerStorageKey)
    }
  }, [ledgerStorageKey])

  useEffect(() => {
    try {
      localStorage.setItem(ledgerStorageKey, JSON.stringify(executionLedger.slice(-24)))
    } catch {
      // ignore
    }
  }, [executionLedger, ledgerStorageKey])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatTurns, pendingPlan, agentTaskPlan, loading, taskExecuting])

  const handleImageFile = async (file: File | null | undefined, target: 'layout' | 'attach' = 'layout') => {
    if (!file || !file.type.startsWith('image/')) return
    setError('')
    setPendingPlan(null)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      if (target === 'attach') {
        setAttachImage(dataUrl)
      } else {
        setImageDataUrl(dataUrl)
      }
    } catch {
      setError('读取图片失败')
    }
  }

  const handleSendChat = async () => {
    const text = chatInput.trim()
    if (!text && !attachImage) {
      setError('请输入需求，或附加参考图')
      return
    }
    setLoading(true)
    setError('')
    setPendingPlan(null)
    setAgentTaskPlan(null)
    setAgentDebugTrace(null)

    const userTurn: AgentChatTurn = {
      id: nanoid(),
      role: 'user',
      content: text || '（附图）请理解并协助剪辑',
      imagePreview: attachImage || undefined,
    }
    setChatTurns((prev) => [...prev, userTurn])
    setChatInput('')
    const sentImage = attachImage
    setAttachImage('')

    try {
      const result = await runAgentChat({
        projectId,
        sessionId,
        userMessage: text,
        executionLedger: executionLedgerRef.current,
        imageDataUrl: sentImage || null,
        layoutReference: layout,
      })

      if (result.execution_ledger) {
        setExecutionLedger(result.execution_ledger)
      }

      if (result.debug_trace) {
        setAgentDebugTrace(result.debug_trace)
      }

      if (result.task_plan?.tasks.length) {
        setAgentTaskPlan(result.task_plan)
        setChatTurns((prev) => [
          ...prev,
          {
            id: nanoid(),
            role: 'assistant',
            content: result.assistant_message || '已生成任务计划，请确认后开始逐项执行。',
          },
        ])
      } else if (result.plan?.tool_calls.length) {
        setPendingPlan(result.plan)
        setChatTurns((prev) => [
          ...prev,
          {
            id: nanoid(),
            role: 'assistant',
            content: result.assistant_message || '已生成操作计划，请确认后执行。',
          },
        ])
      } else {
        setChatTurns((prev) => [
          ...prev,
          { id: nanoid(), role: 'assistant', content: result.assistant_message },
        ])
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, '助手请求失败'))
    } finally {
      setLoading(false)
    }
  }

  const runAnalyze = async (): Promise<LayoutAnalysis | null> => {
    if (!imageDataUrl) {
      setError('请先上传参考图')
      return null
    }
    const response = await editorAgentApi.analyzeLayout(projectId, sessionId, {
      image_base64: imageDataUrl,
      prompt: layoutPrompt.trim(),
    })
    setLayout(response.layout)
    setSummary(response.summary)
    persistReference(response.layout, response.summary, imageDataUrl, layoutPrompt.trim())
    return response.layout
  }

  const handleAnalyzeOnly = async () => {
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

  const handleLayoutApply = async () => {
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
        userPrompt: layoutPrompt.trim(),
        imageDataUrl,
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

  const handleConfirmTaskPlan = async () => {
    if (!agentTaskPlan?.tasks.length) return
    const userGoal =
      [...chatTurns].reverse().find((turn) => turn.role === 'user')?.content?.trim() ||
      agentTaskPlan.goal
    setTaskExecuting(true)
    setExecuting(true)
    setError('')
    setAgentDebugTrace(null)
    try {
      const result = await executeAgentTaskPlan({
        projectId,
        sessionId,
        userGoal,
        taskPlan: agentTaskPlan,
        layoutReference: layout,
        onProgress: (plan) => setAgentTaskPlan(plan),
      })
      setAgentTaskPlan(result.taskPlan)
      if (result.debug_trace) {
        setAgentDebugTrace(result.debug_trace)
      }
      if (result.pendingPlan?.tool_calls.length) {
        setPendingPlan(result.pendingPlan)
        setChatTurns((prev) => [
          ...prev,
          {
            id: nanoid(),
            role: 'assistant',
            content: result.assistant_message || '任务执行暂停，需确认危险或额外操作。',
          },
        ])
        return
      }
      const allDone = result.taskPlan.tasks.every((task) => task.status === 'done')
      if (allDone) {
        setAgentTaskPlan(null)
      }
      const taskRecords = result.taskPlan.tasks
        .filter((task) => task.summary?.trim())
        .map((task) => `[${task.id}] ${task.title}: ${task.summary!.trim()}`)
      if (taskRecords.length > 0) {
        setExecutionLedger((prev) => mergeExecutionLedger(prev, taskRecords))
      }
      setChatTurns((prev) => [
        ...prev,
        { id: nanoid(), role: 'assistant', content: result.assistant_message },
      ])
    } catch (err: unknown) {
      setError(extractErrorMessage(err, '任务执行失败'))
    } finally {
      setTaskExecuting(false)
      setExecuting(false)
    }
  }

  const handleConfirmExecute = async () => {
    if (!pendingPlan?.tool_calls.length) return
    const appliedPlan = pendingPlan
    setExecuting(true)
    setError('')
    try {
      const results = await confirmExecutePlan(appliedPlan.tool_calls, projectId)
      const failed = results.find((item) => !item.ok)
      const nextLedger = mergeExecutionLedger(
        executionLedgerRef.current,
        buildExecutionRecords(appliedPlan.tool_calls, results)
      )
      setExecutionLedger(nextLedger)
      if (failed) {
        setError(failed.error ?? '部分操作失败')
        return
      }

      setPendingPlan(null)
      const appliedMsg = '已应用到时间线，可预览并撤销。'
      setSummary(appliedMsg)
      setChatTurns((prev) => [...prev, { id: nanoid(), role: 'assistant', content: appliedMsg }])

      setLoading(true)
      setAgentDebugTrace(null)
      try {
        const verifyResult = await continueAgentChatAfterApply({
          projectId,
          sessionId,
          executionLedger: nextLedger,
          toolCalls: appliedPlan.tool_calls,
          toolResults: results,
          layoutReference: layout,
        })

        if (verifyResult.execution_ledger) {
          setExecutionLedger(verifyResult.execution_ledger)
        }

        if (verifyResult.debug_trace) {
          setAgentDebugTrace(verifyResult.debug_trace)
        }

        if (verifyResult.plan?.tool_calls.length) {
          setPendingPlan(verifyResult.plan)
          setChatTurns((prev) => [
            ...prev,
            {
              id: nanoid(),
              role: 'assistant',
              content: verifyResult.assistant_message || '验证后建议进一步调整，请确认执行。',
            },
          ])
        } else if (verifyResult.assistant_message.trim()) {
          setChatTurns((prev) => [
            ...prev,
            { id: nanoid(), role: 'assistant', content: verifyResult.assistant_message },
          ])
        }
      } catch (verifyErr: unknown) {
        setError(extractErrorMessage(verifyErr, '执行后验证失败'))
      } finally {
        setLoading(false)
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, '执行失败'))
    } finally {
      setExecuting(false)
    }
  }

  const handleExportMomentsToTimeline = async () => {
    if (!lastMomentSearch || lastMomentSearch.matches.length === 0) return
    setExportingMoments(true)
    setError('')
    try {
      const result = applyMomentExtractToTimeline(
        () => useEditSessionStore.getState(),
        lastMomentSearch
      )
      clearLastMomentSearch(sessionId)
      setChatTurns((prev) => [
        ...prev,
        { id: nanoid(), role: 'assistant', content: result.assistant_message },
      ])
    } catch (err: unknown) {
      setError(extractErrorMessage(err, '裁到时间线失败'))
    } finally {
      setExportingMoments(false)
    }
  }

  const handleExportMomentsToPool = async () => {
    if (!lastMomentSearch || lastMomentSearch.matches.length === 0) return
    setExportingMoments(true)
    setError('')
    try {
      const result = await applyMomentExtractToPool(
        () => useEditSessionStore.getState(),
        {
          projectId,
          sessionId,
          blockId: lastMomentSearch.blockId,
          blockTitle: lastMomentSearch.blockTitle,
          searchCriteria: lastMomentSearch.searchCriteria,
          matches: lastMomentSearch.matches,
        }
      )
      clearLastMomentSearch(sessionId)
      setChatTurns((prev) => [
        ...prev,
        { id: nanoid(), role: 'assistant', content: result.assistant_message },
      ])
    } catch (err: unknown) {
      setError(extractErrorMessage(err, '写入素材池失败'))
    } finally {
      setExportingMoments(false)
    }
  }

  const panelBody = (
    <>
      <div className="editor-agent-panel__segmented">
        <button
          type="button"
          className={mode === 'assistant' ? 'is-active' : ''}
          onClick={() => setMode('assistant')}
        >
          助手
        </button>
        <button
          type="button"
          className={mode === 'layout_reference' ? 'is-active' : ''}
          onClick={() => setMode('layout_reference')}
        >
          参考图排版
        </button>
      </div>

      {mode === 'assistant' ? (
        <div className="editor-agent-panel__assistant">
          <p className="editor-agent-panel__hint">
            用自然语言描述需求：加字、改样式、移视频、裁片段等。改时间线前会展示操作清单。
          </p>

          {focusedBlock ? (
            <div className="editor-agent-panel__focus">
              <div className="editor-agent-panel__focus-body">
                <span className="editor-agent-panel__focus-label">提问片段</span>
                <span className="editor-agent-panel__focus-title">
                  {focusedBlock.title || '未命名片段'}
                </span>
                <span className="editor-agent-panel__focus-meta">
                  {formatClipDuration(blockVisibleDurationSec(focusedBlock))}
                </span>
              </div>
              <button
                type="button"
                className="editor-agent-panel__focus-clear"
                onClick={() => clearFocusedBlock(sessionId)}
              >
                移除
              </button>
            </div>
          ) : null}

          <div className="editor-agent-panel__chat">
            {chatTurns.length === 0 ? (
              <p className="editor-agent-panel__chat-empty">
                例如：「在播放头位置加一行说明文字」「把主轨视频往左移一点」
              </p>
            ) : (
              chatTurns.map((turn) => (
                <div
                  key={turn.id}
                  className={`editor-agent-panel__chat-bubble editor-agent-panel__chat-bubble--${turn.role}`}
                >
                  {turn.imagePreview ? (
                    <img src={turn.imagePreview} alt="" className="editor-agent-panel__chat-image" />
                  ) : null}
                  <p>{turn.content}</p>
                </div>
              ))
            )}
            {loading ? <p className="editor-agent-panel__chat-status">思考中…</p> : null}
            <div ref={chatEndRef} />
          </div>

          {lastMomentSearch && lastMomentSearch.matches.length > 0 ? (
            <div className="editor-agent-panel__moment-export">
              <p className="editor-agent-panel__moment-export-title">
                {formatMomentExportChoiceHint(lastMomentSearch.matches.length)}
              </p>
              <div className="editor-agent-panel__actions">
                <button
                  type="button"
                  className="editor-agent-panel__btn editor-agent-panel__btn--primary"
                  disabled={exportingMoments || loading}
                  onClick={() => void handleExportMomentsToPool()}
                >
                  {exportingMoments ? '导出中…' : `写入本草稿 AI 素材（${lastMomentSearch.matches.length}）`}
                </button>
                <button
                  type="button"
                  className="editor-agent-panel__btn"
                  disabled={exportingMoments || loading}
                  onClick={() => void handleExportMomentsToTimeline()}
                >
                  裁到时间线
                </button>
                <button
                  type="button"
                  className="editor-agent-panel__btn"
                  disabled={exportingMoments}
                  onClick={() => clearLastMomentSearch(sessionId)}
                >
                  暂不
                </button>
              </div>
            </div>
          ) : null}

          <div className="editor-agent-panel__composer">
            {attachImage ? (
              <div className="editor-agent-panel__attach-preview">
                <img src={attachImage} alt="附件" />
                <button type="button" onClick={() => setAttachImage('')}>
                  移除
                </button>
              </div>
            ) : null}

            <textarea
              className="editor-agent-panel__textarea"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={
                focusedBlock
                  ? `针对「${focusedBlock.title || '当前片段'}」提问，例如：这段有多长？`
                  : '描述你想对剪辑区做的操作…'
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void handleSendChat()
                }
              }}
            />

            <div className="editor-agent-panel__actions">
              <button
                type="button"
                className="editor-agent-panel__btn"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
              >
                附图
              </button>
              <button
                type="button"
                className="editor-agent-panel__btn editor-agent-panel__btn--primary"
                disabled={loading || executing}
                onClick={() => void handleSendChat()}
              >
                {loading ? '处理中…' : '发送'}
              </button>
            </div>
            <p className="editor-agent-panel__hint editor-agent-panel__hint--sub">Ctrl+Enter 发送</p>

            {agentDebugTrace ? (
              <div className="editor-agent-panel__debug">
                <button
                  type="button"
                  className="editor-agent-panel__debug-toggle"
                  onClick={() => setShowAgentDebug((open) => !open)}
                >
                  {showAgentDebug ? '隐藏诊断' : '查看诊断'}
                  {agentDebugTrace.outcome === 'exhausted' ? ' · 轮次用尽' : ''}
                </button>
                {showAgentDebug ? (
                  <pre className="editor-agent-panel__debug-body">{formatAgentDebugDetail(agentDebugTrace)}</pre>
                ) : (
                  <p className="editor-agent-panel__debug-summary">
                    {formatAgentDebugSummary(agentDebugTrace)}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <p className="editor-agent-panel__hint">
            上传参考图分析排版样式，再一键套用到当前草稿（文案来自工程，不抄图上的字）。
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="editor-agent-panel__file-input"
            onChange={(event) => void handleImageFile(event.target.files?.[0], 'layout')}
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
              void handleImageFile(event.dataTransfer.files?.[0], 'layout')
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
            value={layoutPrompt}
            onChange={(event) => setLayoutPrompt(event.target.value)}
            placeholder="排版意图说明…"
          />

          <div className="editor-agent-panel__actions">
            <button
              type="button"
              className="editor-agent-panel__btn"
              disabled={loading}
              onClick={() => void handleAnalyzeOnly()}
            >
              仅分析
            </button>
            <button
              type="button"
              className="editor-agent-panel__btn editor-agent-panel__btn--primary"
              disabled={loading || executing}
              onClick={() => void handleLayoutApply()}
            >
              {loading ? '处理中…' : '分析并应用'}
            </button>
          </div>

          {layout ? (
            <pre className="editor-agent-panel__json">{JSON.stringify(layout, null, 2)}</pre>
          ) : null}
        </>
      )}

      {agentTaskPlan ? (
        <div className="editor-agent-panel__task-plan">
          <p className="editor-agent-panel__plan-title">
            任务计划 · {agentTaskPlan.tasks.length} 步
          </p>
          <p className="editor-agent-panel__task-goal">{agentTaskPlan.goal}</p>
          <ul className="editor-agent-panel__task-list">
            {agentTaskPlan.tasks.map((task) => (
              <li
                key={task.id}
                className={`editor-agent-panel__task-item editor-agent-panel__task-item--${task.status ?? 'pending'}`}
              >
                <span className="editor-agent-panel__task-id">{task.id}</span>
                <span className="editor-agent-panel__task-title">{task.title}</span>
                {task.summary ? (
                  <span className="editor-agent-panel__task-summary">{task.summary}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {!taskExecuting ? (
            <div className="editor-agent-panel__actions">
              <button
                type="button"
                className="editor-agent-panel__btn editor-agent-panel__btn--primary"
                disabled={executing || loading}
                onClick={() => void handleConfirmTaskPlan()}
              >
                开始逐项执行
              </button>
              <button
                type="button"
                className="editor-agent-panel__btn"
                disabled={executing || loading}
                onClick={() => setAgentTaskPlan(null)}
              >
                取消
              </button>
            </div>
          ) : (
            <p className="editor-agent-panel__chat-status">正在执行任务…</p>
          )}
        </div>
      ) : null}

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
      {summary && mode === 'layout_reference' ? (
        <p className="editor-agent-panel__summary">{summary}</p>
      ) : null}
    </>
  )

  if (collapsed) {
    return (
      <aside
        ref={panelRef}
        className={`editor-agent-panel is-collapsed${dragging ? ' is-dragging' : ''}`}
        style={panelStyle}
      >
        <div
          className="editor-agent-panel__header editor-agent-panel__header--draggable"
          onPointerDown={onHeaderPointerDown}
        >
          <h2 className="editor-agent-panel__title">AI 助手</h2>
          <button type="button" className="editor-agent-panel__toggle" onClick={() => setCollapsed(false)}>
            展开
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside
      ref={panelRef}
      className={`editor-agent-panel${dragging ? ' is-dragging' : ''}`}
      style={panelStyle}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="editor-agent-panel__file-input"
        onChange={(event) =>
          void handleImageFile(event.target.files?.[0], mode === 'assistant' ? 'attach' : 'layout')
        }
      />

      <div
        className="editor-agent-panel__header editor-agent-panel__header--draggable"
        onPointerDown={onHeaderPointerDown}
      >
        <h2 className="editor-agent-panel__title">AI 助手</h2>
        <button type="button" className="editor-agent-panel__toggle" onClick={() => setCollapsed(true)}>
          收起
        </button>
      </div>

      <div className="editor-agent-panel__body">{panelBody}</div>
    </aside>
  )
}

const PlanLine: React.FC<{ call: AgentToolCall }> = ({ call }) => (
  <li className={isDangerousAgentTool(call.name) ? 'is-dangerous' : undefined}>
    {formatToolCallSummary(call.name, call.arguments)}
  </li>
)

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const detail = String(
      (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || fallback
    )
    if (detail.includes('工具不在白名单')) {
      return `${detail}。请重启后端（托盘图标 → 重启后端服务，或重新运行 python -m backend.desktop_main）。`
    }
    return detail
  }
  return err instanceof Error ? err.message : fallback
}

export default EditorAgentPanel
