import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_EDGE_TTS_VOICE,
  EDGE_TTS_VOICES_ZH,
} from '../../../editor/tts/edgeTtsVoices'
import { voiceoverApi } from '../../../services/voiceoverApi'
import type { VoiceoverPlan, VoiceoverSegment } from '../../../types/voiceoverPlan'
import {
  MAX_VOICEOVER_SEGMENTS,
  VOICEOVER_PLAN_STATUS_LABEL,
} from '../../../types/voiceoverPlan'
import { useEditSessionStore } from '../../../stores/useEditSessionStore'

interface VoiceoverPlanPanelProps {
  projectId: string
  sessionId: string
  onError: (message: string) => void
}

function clonePlan(plan: VoiceoverPlan): VoiceoverPlan {
  return JSON.parse(JSON.stringify(plan)) as VoiceoverPlan
}

function queriesToText(queries: string[]): string {
  return queries.join('\n')
}

function textToQueries(text: string): string[] {
  return text
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
}

const VoiceoverPlanPanel: React.FC<VoiceoverPlanPanelProps> = ({
  projectId,
  sessionId,
  onError,
}) => {
  const sessionPlan = useEditSessionStore((state) => state.session?.voiceover_plan ?? null)
  const syncSessionFromApi = useEditSessionStore((state) => state.syncSessionFromApi)

  const [userBrief, setUserBrief] = useState('')
  const [draftPlan, setDraftPlan] = useState<VoiceoverPlan | null>(null)
  const [voiceId, setVoiceId] = useState(DEFAULT_EDGE_TTS_VOICE)
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [segmentInstructions, setSegmentInstructions] = useState<Record<string, string>>({})

  const plan = draftPlan ?? sessionPlan
  const isEditable = plan?.status === 'draft'

  useEffect(() => {
    if (sessionPlan?.user_brief && !userBrief) {
      setUserBrief(sessionPlan.user_brief)
    }
    if (sessionPlan?.voice_id) {
      setVoiceId(sessionPlan.voice_id)
    }
  }, [sessionPlan, userBrief])

  useEffect(() => {
    if (sessionPlan && !draftPlan) {
      setDraftPlan(null)
    }
  }, [sessionPlan, draftPlan])

  const applyResponse = useCallback(
    (response: { session: Parameters<typeof syncSessionFromApi>[0] }) => {
      syncSessionFromApi(response.session)
      setDraftPlan(null)
    },
    [syncSessionFromApi]
  )

  const handleGenerate = async () => {
    const brief = userBrief.trim()
    if (!brief) {
      onError('请先输入口播意图或原文')
      return
    }
    if (sessionPlan && !replaceExisting) {
      onError('已有口播计划：请勾选「重新生成（覆盖现有草稿）」，或直接在下方编辑后保存')
      return
    }
    setLoading(true)
    onError('')
    try {
      const response = await voiceoverApi.generate(projectId, sessionId, {
        user_brief: brief,
        voice_id: voiceId,
        replace_existing: Boolean(sessionPlan && replaceExisting),
      })
      applyResponse(response)
      setUserBrief(response.plan.user_brief)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : '口播脚本生成失败')
    } finally {
      setLoading(false)
    }
  }

  const updateLocalSegment = (segmentId: string, patch: Partial<VoiceoverSegment>) => {
    if (!plan || !isEditable) return
    const next = clonePlan(plan)
    next.segments = next.segments.map((seg) =>
      seg.id === segmentId ? { ...seg, ...patch } : seg
    )
    setDraftPlan(next)
  }

  const handleSave = async () => {
    if (!plan || !isEditable) return
    setSaving(true)
    onError('')
    try {
      const response = await voiceoverApi.updatePlan(projectId, sessionId, plan)
      applyResponse(response)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : '保存口播脚本失败')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirm = async () => {
    if (!plan) return
    setSaving(true)
    onError('')
    try {
      if (draftPlan) {
        await voiceoverApi.updatePlan(projectId, sessionId, draftPlan)
      }
      const response = await voiceoverApi.confirm(projectId, sessionId)
      applyResponse(response)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : '确认口播脚本失败')
    } finally {
      setSaving(false)
    }
  }

  const handleResetDraft = async () => {
    setSaving(true)
    onError('')
    try {
      const response = await voiceoverApi.resetDraft(projectId, sessionId)
      applyResponse(response)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : '重置失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('确定删除口播计划？')) return
    setSaving(true)
    onError('')
    try {
      const response = await voiceoverApi.deletePlan(projectId, sessionId)
      applyResponse(response)
      setDraftPlan(null)
      setUserBrief('')
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }

  const handleRegenerateSegment = async (segmentId: string) => {
    setLoading(true)
    onError('')
    try {
      if (draftPlan && isEditable) {
        await voiceoverApi.updatePlan(projectId, sessionId, draftPlan)
      }
      const response = await voiceoverApi.regenerateSegment(
        projectId,
        sessionId,
        segmentId,
        segmentInstructions[segmentId]?.trim() || undefined
      )
      applyResponse(response)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : '分段重写失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAddSegment = async (afterSegmentId?: string) => {
    setSaving(true)
    onError('')
    try {
      if (draftPlan && isEditable) {
        await voiceoverApi.updatePlan(projectId, sessionId, draftPlan)
      }
      const response = await voiceoverApi.addSegment(projectId, sessionId, afterSegmentId)
      applyResponse(response)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : '添加分段失败')
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveSegment = async (segmentId: string) => {
    if (!window.confirm('确定删除该分段？')) return
    setSaving(true)
    onError('')
    try {
      const response = await voiceoverApi.removeSegment(projectId, sessionId, segmentId)
      applyResponse(response)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : '删除分段失败')
    } finally {
      setSaving(false)
    }
  }

  const statusLabel = useMemo(() => {
    if (!plan) return null
    return VOICEOVER_PLAN_STATUS_LABEL[plan.status] ?? plan.status
  }, [plan])

  return (
    <div className="editor-agent-panel__voiceover">
      <p className="editor-agent-panel__voiceover-intro">
        输入口播意图或完整文稿，生成分段脚本（口播文案 + 画面描述 + 素材关键词）。确认后将进入里程碑
        B（TTS 与字幕），当前里程碑 A 仅编辑与确认脚本。
      </p>

      <label className="editor-agent-panel__voiceover-field">
        <span>口播意图 / 原文</span>
        <textarea
          className="editor-agent-panel__voiceover-textarea"
          rows={5}
          value={userBrief}
          onChange={(event) => setUserBrief(event.target.value)}
          placeholder="例如：3 分钟产品介绍口播，风格专业克制，分 5 段讲痛点、方案、案例…"
          disabled={loading || saving}
        />
      </label>

      <div className="editor-agent-panel__voiceover-row">
        <label className="editor-agent-panel__voiceover-field editor-agent-panel__voiceover-field--inline">
          <span>音色</span>
          <select
            className="editor-agent-panel__voiceover-select"
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value)}
            disabled={loading || saving}
          >
            {EDGE_TTS_VOICES_ZH.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </select>
        </label>
        {sessionPlan ? (
          <label className="editor-agent-panel__voiceover-check">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(event) => setReplaceExisting(event.target.checked)}
              disabled={loading || saving}
            />
            重新生成（覆盖现有草稿）
          </label>
        ) : null}
      </div>

      <div className="editor-agent-panel__voiceover-actions">
        <button
          type="button"
          className="editor-agent-panel__voiceover-btn editor-agent-panel__voiceover-btn--primary"
          onClick={() => void handleGenerate()}
          disabled={loading || saving}
        >
          {loading ? '生成中…' : plan ? '重新生成脚本' : '生成分段脚本'}
        </button>
      </div>

      {plan ? (
        <>
          <div className="editor-agent-panel__voiceover-meta">
            <span>
              状态：<strong>{statusLabel}</strong>
            </span>
            <span>{plan.segments.length} 段</span>
            {draftPlan ? <span className="editor-agent-panel__voiceover-unsaved">未保存</span> : null}
          </div>

          <div className="editor-agent-panel__voiceover-segments">
            {plan.segments.map((segment) => (
              <article key={segment.id} className="editor-agent-panel__voiceover-segment">
                <header className="editor-agent-panel__voiceover-segment-head">
                  <span>第 {segment.index} 段</span>
                  {isEditable ? (
                    <div className="editor-agent-panel__voiceover-segment-tools">
                      <button
                        type="button"
                        className="editor-agent-panel__voiceover-link"
                        onClick={() => void handleAddSegment(segment.id)}
                        disabled={plan.segments.length >= MAX_VOICEOVER_SEGMENTS || saving}
                      >
                        后插
                      </button>
                      <button
                        type="button"
                        className="editor-agent-panel__voiceover-link"
                        onClick={() => void handleRemoveSegment(segment.id)}
                        disabled={plan.segments.length <= 1 || saving}
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </header>

                <label className="editor-agent-panel__voiceover-field">
                  <span>口播文案</span>
                  <textarea
                    className="editor-agent-panel__voiceover-textarea"
                    rows={3}
                    value={segment.narration_text}
                    onChange={(event) =>
                      updateLocalSegment(segment.id, { narration_text: event.target.value })
                    }
                    disabled={!isEditable || saving}
                  />
                </label>

                <label className="editor-agent-panel__voiceover-field">
                  <span>画面描述</span>
                  <textarea
                    className="editor-agent-panel__voiceover-textarea"
                    rows={2}
                    value={segment.visual_brief}
                    onChange={(event) =>
                      updateLocalSegment(segment.id, { visual_brief: event.target.value })
                    }
                    disabled={!isEditable || saving}
                  />
                </label>

                <label className="editor-agent-panel__voiceover-field">
                  <span>素材搜索词（每行一个）</span>
                  <textarea
                    className="editor-agent-panel__voiceover-textarea"
                    rows={2}
                    value={queriesToText(segment.search_queries)}
                    onChange={(event) =>
                      updateLocalSegment(segment.id, {
                        search_queries: textToQueries(event.target.value),
                      })
                    }
                    disabled={!isEditable || saving}
                  />
                </label>

                {isEditable ? (
                  <div className="editor-agent-panel__voiceover-segment-regen">
                    <input
                      type="text"
                      className="editor-agent-panel__voiceover-input"
                      placeholder="重写提示（可选）"
                      value={segmentInstructions[segment.id] ?? ''}
                      onChange={(event) =>
                        setSegmentInstructions((prev) => ({
                          ...prev,
                          [segment.id]: event.target.value,
                        }))
                      }
                      disabled={loading || saving}
                    />
                    <button
                      type="button"
                      className="editor-agent-panel__voiceover-btn"
                      onClick={() => void handleRegenerateSegment(segment.id)}
                      disabled={loading || saving}
                    >
                      LLM 重写本段
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <div className="editor-agent-panel__voiceover-footer">
            {isEditable ? (
              <>
                <button
                  type="button"
                  className="editor-agent-panel__voiceover-btn"
                  onClick={() => void handleAddSegment()}
                  disabled={plan.segments.length >= MAX_VOICEOVER_SEGMENTS || saving}
                >
                  添加分段
                </button>
                <button
                  type="button"
                  className="editor-agent-panel__voiceover-btn"
                  onClick={() => void handleSave()}
                  disabled={saving || !draftPlan}
                >
                  {saving ? '保存中…' : '保存修改'}
                </button>
                <button
                  type="button"
                  className="editor-agent-panel__voiceover-btn editor-agent-panel__voiceover-btn--primary"
                  onClick={() => void handleConfirm()}
                  disabled={saving}
                >
                  确认脚本
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="editor-agent-panel__voiceover-btn"
                  onClick={() => void handleResetDraft()}
                  disabled={saving || plan.status === 'executing'}
                >
                  改回草稿
                </button>
              </>
            )}
            <button
              type="button"
              className="editor-agent-panel__voiceover-btn editor-agent-panel__voiceover-btn--danger"
              onClick={() => void handleDelete()}
              disabled={saving}
            >
              删除计划
            </button>
          </div>

          {plan.status === 'confirmed' ? (
            <p className="editor-agent-panel__voiceover-hint">
              脚本已确认。里程碑 B（TTS 上轨 + 句/词级字幕）尚未接入，请勿期待时间线自动变化。
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default VoiceoverPlanPanel
