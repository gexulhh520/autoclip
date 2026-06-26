import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_EDGE_TTS_VOICE,
  formatEdgeTtsVoiceLabel,
  getEdgeTtsVoiceGroups,
  resolveEdgeTtsVoiceId,
} from '../../../editor/tts/edgeTtsVoices'
import { voiceoverApi } from '../../../services/voiceoverApi'
import libraryApi, { type LibraryAsset } from '../../../services/libraryApi'
import type { VoiceoverPlan, VoiceoverSegment, VoiceoverSearchQueryLanguage } from '../../../types/voiceoverPlan'
import {
  MAX_VOICEOVER_SEGMENTS,
  VOICEOVER_BROLL_APPLY_STAGE_LABEL,
  VOICEOVER_PLAN_STATUS_LABEL,
  VOICEOVER_SEGMENT_STATUS_LABEL,
} from '../../../types/voiceoverPlan'
import { useEditSessionStore } from '../../../stores/useEditSessionStore'
import { openExternalLink } from '../../../utils/externalLinks'

interface VoiceoverPlanPanelProps {
  projectId: string
  sessionId: string
  onError: (message: string) => void
  onPlanConfirmed?: () => void
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

const BROLL_APPLY_POLL_MS = 1500
const BROLL_APPLY_MAX_WAIT_MS = 600_000

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

const SEARCH_QUERY_LANGUAGES: Array<{ id: VoiceoverSearchQueryLanguage; label: string }> = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
]

function readApiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const axiosErr = err as {
      userMessage?: string
      message?: string
      response?: { data?: { detail?: unknown } }
    }
    if (axiosErr.userMessage?.trim()) {
      return axiosErr.userMessage
    }
    const detail = axiosErr.response?.data?.detail
    if (typeof detail === 'string' && detail.trim()) {
      if (/Expecting value|JSON 无效|工程文件损坏|Ollama 返回空响应|LLM 返回空内容/i.test(detail)) {
        return detail.includes('Expecting value')
          ? '服务返回了无效数据。若在执行口播 TTS，请确认 edge-tts 可用；若在生成脚本，请检查 Ollama/API 是否正常运行。'
          : detail
      }
      return detail
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const joined = detail
        .map((item) => (item && typeof item === 'object' && 'msg' in item ? String(item.msg ?? '') : ''))
        .filter(Boolean)
        .join('；')
      if (joined) return joined
    }
    if (axiosErr.message?.trim() && !axiosErr.message.includes('status code')) {
      return axiosErr.message
    }
  }
  return fallback
}

const VoiceoverPlanPanel: React.FC<VoiceoverPlanPanelProps> = ({
  projectId,
  sessionId,
  onError,
  onPlanConfirmed,
}) => {
  const sessionPlan = useEditSessionStore((state) => state.session?.voiceover_plan ?? null)
  const syncSessionFromApi = useEditSessionStore((state) => state.syncSessionFromApi)
  const withServerMutation = useEditSessionStore((state) => state.withServerMutation)

  const [userBrief, setUserBrief] = useState('')
  const [draftPlan, setDraftPlan] = useState<VoiceoverPlan | null>(null)
  const [voiceId, setVoiceId] = useState(DEFAULT_EDGE_TTS_VOICE)
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [segmentInstructions, setSegmentInstructions] = useState<Record<string, string>>({})
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([])
  const [placeholderAssetId, setPlaceholderAssetId] = useState('')
  const [brollPlatform, setBrollPlatform] = useState<'youtube' | 'bilibili'>('youtube')
  const [selectedSearchIndex, setSelectedSearchIndex] = useState<Record<string, number>>({})
  const [libraryPickBySegment, setLibraryPickBySegment] = useState<Record<string, string>>({})
  const [manualTrim, setManualTrim] = useState<Record<string, { inSec: string; outSec: string }>>({})
  const [brollBusySegmentId, setBrollBusySegmentId] = useState<string | null>(null)
  const [brollApplyProgress, setBrollApplyProgress] = useState<{
    segmentId: string
    stage: string
    progress: number
    message: string
    downloadProgress?: number
  } | null>(null)
  const [searchQueryDrafts, setSearchQueryDrafts] = useState<Record<string, string>>({})
  const [translatingSegmentId, setTranslatingSegmentId] = useState<string | null>(null)
  const [translateTargetLanguage, setTranslateTargetLanguage] =
    useState<VoiceoverSearchQueryLanguage>('en')

  const plan = draftPlan ?? sessionPlan
  const isEditable = plan?.status === 'draft'
  const canExecute = Boolean(
    plan &&
      ['confirmed', 'executing', 'failed', 'completed'].includes(plan.status)
  )
  const needsMaterialLibrary = Boolean(
    plan &&
      !isEditable &&
      plan.segments.some((seg) =>
        ['tts_done', 'broll_done', 'failed'].includes(seg.status)
      )
  )

  useEffect(() => {
    if (sessionPlan?.user_brief && !userBrief) {
      setUserBrief(sessionPlan.user_brief)
    }
    if (sessionPlan?.voice_id) {
      setVoiceId(sessionPlan.voice_id)
    }
    if (sessionPlan?.placeholder_library_asset_id) {
      setPlaceholderAssetId(sessionPlan.placeholder_library_asset_id)
    }
  }, [sessionPlan, userBrief])

  useEffect(() => {
    if (!canExecute && !needsMaterialLibrary) return
    let cancelled = false
    void libraryApi
      .listAssets({ page: 1, page_size: 48, sort: 'created_at_desc' })
      .then((page) => {
        if (!cancelled) {
          setLibraryAssets(page.items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLibraryAssets([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [canExecute, needsMaterialLibrary, projectId, sessionId])

  useEffect(() => {
    let cancelled = false
    void voiceoverApi
      .getPlan(projectId, sessionId)
      .then((response) => {
        if (!cancelled && response.session) {
          syncSessionFromApi(response.session)
        }
      })
      .catch(() => {
        // 尚无 plan 时 GET 可能为空，忽略
      })
    return () => {
      cancelled = true
    }
  }, [projectId, sessionId, syncSessionFromApi])

  useEffect(() => {
    if (sessionPlan && !draftPlan) {
      setDraftPlan(null)
    }
  }, [sessionPlan, draftPlan])

  const applyResponse = useCallback(
    (response: { session: Parameters<typeof syncSessionFromApi>[0] }) => {
      syncSessionFromApi(response.session)
      setDraftPlan(null)
      setSearchQueryDrafts({})
    },
    [syncSessionFromApi]
  )

  const applyVoiceoverApi = useCallback(
    async <T extends { session: Parameters<typeof syncSessionFromApi>[0] }>(
      operation: () => Promise<T>
    ): Promise<T> => {
      const response = await withServerMutation(operation)
      applyResponse(response)
      return response
    },
    [applyResponse, withServerMutation]
  )

  const pollBrollApply = useCallback(
    async (segmentId: string, operationId: string) => {
      const deadline = Date.now() + BROLL_APPLY_MAX_WAIT_MS
      while (Date.now() < deadline) {
        const status = await voiceoverApi.getBrollApplyStatus(projectId, sessionId, operationId)
        setBrollApplyProgress({
          segmentId,
          stage: status.stage,
          progress: status.progress,
          message: status.message,
          downloadProgress: status.download_progress ?? undefined,
        })
        if (status.done) {
          if (status.failed) {
            if (status.session) {
              syncSessionFromApi(status.session)
              setDraftPlan(null)
              setSearchQueryDrafts({})
            }
            throw new Error(status.error || status.message || 'B-roll 应用失败')
          }
          if (status.session) {
            syncSessionFromApi(status.session)
            setDraftPlan(null)
            setSearchQueryDrafts({})
          }
          return status
        }
        await sleep(BROLL_APPLY_POLL_MS)
      }
      throw new Error(
        'B-roll 应用等待超时，任务可能仍在后台进行。请稍后重新打开草稿查看，勿重复点击。'
      )
    },
    [projectId, sessionId, syncSessionFromApi]
  )

  const canEditSearchQueries = (segment: VoiceoverSegment) =>
    isEditable || (Boolean(plan) && plan.status !== 'draft')

  const getSearchQueriesText = (segment: VoiceoverSegment) =>
    searchQueryDrafts[segment.id] ?? queriesToText(segment.search_queries)

  const resolveSearchQueriesForSegment = (segment: VoiceoverSegment) =>
    textToQueries(getSearchQueriesText(segment))

  const handleSearchQueriesChange = (segment: VoiceoverSegment, text: string) => {
    if (isEditable) {
      updateLocalSegment(segment.id, { search_queries: textToQueries(text) })
      return
    }
    setSearchQueryDrafts((prev) => ({ ...prev, [segment.id]: text }))
  }

  const persistSegmentSearchQueries = async (segment: VoiceoverSegment) => {
    const queries = resolveSearchQueriesForSegment(segment)
    if (isEditable) {
      if (draftPlan) {
        await voiceoverApi.updatePlan(projectId, sessionId, draftPlan)
      }
      return queries
    }
    await voiceoverApi.updateSegmentSearchQueries(projectId, sessionId, segment.id, {
      search_queries: queries,
    })
    const refreshed = await voiceoverApi.getPlan(projectId, sessionId)
    syncSessionFromApi(refreshed.session)
    setSearchQueryDrafts((prev) => {
      const next = { ...prev }
      delete next[segment.id]
      return next
    })
    return queries
  }

  const handleTranslateSearchQueries = async (
    segment: VoiceoverSegment,
    targetLanguage: VoiceoverSearchQueryLanguage
  ) => {
    const queries = resolveSearchQueriesForSegment(segment)
    if (queries.length === 0) {
      onError('请先填写素材搜索词')
      return
    }
    setTranslatingSegmentId(segment.id)
    onError('')
    try {
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.translateSegmentSearchQueries(
          projectId,
          sessionId,
          segment.id,
          {
            target_language: targetLanguage,
            search_queries: queries,
          }
        )
      )
    } catch (err: unknown) {
      onError(readApiErrorMessage(err, '搜索词翻译失败'))
    } finally {
      setTranslatingSegmentId(null)
    }
  }

  const handleGenerate = async () => {
    const brief = userBrief.trim()
    if (!brief) {
      onError('请先输入口播意图或原文')
      return
    }
    if (sessionPlan && sessionPlan.status !== 'draft' && !replaceExisting) {
      onError('口播脚本已确认或执行中：请勾选「重新生成（覆盖现有草稿）」或先「改回草稿」')
      return
    }
    setLoading(true)
    onError('')
    try {
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.generate(projectId, sessionId, {
          user_brief: brief,
          voice_id: voiceId,
          replace_existing: Boolean(replaceExisting),
        })
      )
      setUserBrief(response.plan.user_brief)
      if (response.note.includes('已有口播草稿')) {
        onError('')
      }
    } catch (err: unknown) {
      onError(readApiErrorMessage(err, '口播脚本生成失败'))
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
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.updatePlan(projectId, sessionId, plan)
      )
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
        await withServerMutation(() => voiceoverApi.updatePlan(projectId, sessionId, draftPlan))
      }
      const response = await applyVoiceoverApi(() => voiceoverApi.confirm(projectId, sessionId))
      onPlanConfirmed?.()
      onError('')
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
      const response = await applyVoiceoverApi(() => voiceoverApi.resetDraft(projectId, sessionId))
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
      const response = await applyVoiceoverApi(() => voiceoverApi.deletePlan(projectId, sessionId))
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
        await withServerMutation(() => voiceoverApi.updatePlan(projectId, sessionId, draftPlan))
      }
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.regenerateSegment(
          projectId,
          sessionId,
          segmentId,
          segmentInstructions[segmentId]?.trim() || undefined
        )
      )
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
        await withServerMutation(() => voiceoverApi.updatePlan(projectId, sessionId, draftPlan))
      }
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.addSegment(projectId, sessionId, afterSegmentId)
      )
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : '添加分段失败')
    } finally {
      setSaving(false)
    }
  }

  const handleExecuteAll = async () => {
    if (!plan) return
    if (!hasPendingTts) {
      onError('全部段落已完成 TTS；如需重跑请使用下方「重跑全部」或各段的「重新生成本段 TTS + 字幕」。')
      return
    }
    setExecuting(true)
    onError('')
    try {
      const payload = { placeholder_library_asset_id: placeholderAssetId.trim() || null }
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.execute(projectId, sessionId, payload)
      )
    } catch (err: unknown) {
      onError(readApiErrorMessage(err, '口播 TTS 执行失败'))
    } finally {
      setExecuting(false)
    }
  }

  const handleRerunAll = async () => {
    if (!plan || rerunnableSegmentIds.length === 0) return
    const keepVideo = plan.segments.some((segment) => Boolean(segment.broll?.block_id))
    const message = keepVideo
      ? `将重跑 ${rerunnableSegmentIds.length} 段口播 TTS + 字幕，保留各段时间线上的画面。若某段新口播更长，需确保素材时长足够。继续？`
      : `将重跑 ${rerunnableSegmentIds.length} 段口播 TTS + 字幕。继续？`
    if (!window.confirm(message)) return
    setExecuting(true)
    onError('')
    try {
      const payload = {
        placeholder_library_asset_id: placeholderAssetId.trim() || null,
        segment_ids: rerunnableSegmentIds,
      }
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.execute(projectId, sessionId, payload)
      )
    } catch (err: unknown) {
      onError(readApiErrorMessage(err, '口播 TTS 重跑失败'))
    } finally {
      setExecuting(false)
    }
  }

  const handleExecuteSegment = async (segmentId: string) => {
    const segment = plan?.segments.find((item) => item.id === segmentId)
    if (segment && segmentHasTts(segment)) {
      const keepVideo = Boolean(segment.broll?.block_id)
      const message = keepVideo
        ? '将替换该段音频与字幕，保留时间线上的画面。若新口播更长，需确保素材时长足够。继续？'
        : '将替换该段音频与字幕。继续？'
      if (!window.confirm(message)) return
    }
    setExecuting(true)
    onError('')
    try {
      const payload = { placeholder_library_asset_id: placeholderAssetId.trim() || null }
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.executeSegment(projectId, sessionId, segmentId, payload)
      )
    } catch (err: unknown) {
      onError(readApiErrorMessage(err, '分段 TTS 执行失败'))
    } finally {
      setExecuting(false)
    }
  }

  const handleSearchBroll = async (segment: VoiceoverSegment) => {
    setBrollBusySegmentId(segment.id)
    onError('')
    try {
      let queries = resolveSearchQueriesForSegment(segment)
      if (!isEditable) {
        queries = await persistSegmentSearchQueries(segment)
      }
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.searchSegmentMaterials(
          projectId,
          sessionId,
          segment.id,
          { platform: brollPlatform, limit: 10, search_queries: queries }
        )
      )
      const resultCount =
        response.plan.segments.find((item) => item.id === segment.id)?.broll?.search_results
          ?.length ?? 0
      if (resultCount === 0) {
        onError('未找到可用素材，请尝试修改搜索词、切换平台，或从素材库直接选择')
      }
    } catch (err: unknown) {
      onError(readApiErrorMessage(err, '素材搜索失败'))
    } finally {
      setBrollBusySegmentId(null)
    }
  }

  const handleSelectBroll = async (segmentId: string) => {
    const libraryAssetId = libraryPickBySegment[segmentId]?.trim()
    const searchIndex = selectedSearchIndex[segmentId]
    if (libraryAssetId) {
      setBrollBusySegmentId(segmentId)
      onError('')
      try {
        const response = await applyVoiceoverApi(() =>
          voiceoverApi.selectSegmentMaterial(projectId, sessionId, segmentId, {
            library_asset_id: libraryAssetId,
          })
        )
      } catch (err: unknown) {
        onError(readApiErrorMessage(err, '素材选定失败'))
      } finally {
        setBrollBusySegmentId(null)
      }
      return
    }
    if (searchIndex === undefined || Number.isNaN(searchIndex)) {
      onError('请从搜索结果或素材库中选择一条素材')
      return
    }
    setBrollBusySegmentId(segmentId)
    onError('')
    try {
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.selectSegmentMaterial(projectId, sessionId, segmentId, {
          search_result_index: searchIndex,
        })
      )
    } catch (err: unknown) {
      onError(readApiErrorMessage(err, '素材选定失败'))
    } finally {
      setBrollBusySegmentId(null)
    }
  }

  const handleApplyBroll = async (segmentId: string, useManualTrim: boolean) => {
    setBrollBusySegmentId(segmentId)
    setBrollApplyProgress({
      segmentId,
      stage: 'starting',
      progress: 0,
      message: '准备应用 B-roll…',
    })
    onError('')
    try {
      const manual = manualTrim[segmentId]
      const payload =
        useManualTrim && manual?.inSec && manual?.outSec
          ? {
              source_in_sec: Number.parseFloat(manual.inSec),
              source_out_sec: Number.parseFloat(manual.outSec),
              wait_download_timeout_sec: 600,
            }
          : { wait_download_timeout_sec: 600 }
      await withServerMutation(async () => {
        const { operation_id } = await voiceoverApi.applySegmentBroll(
          projectId,
          sessionId,
          segmentId,
          payload
        )
        await pollBrollApply(segmentId, operation_id)
      })
    } catch (err: unknown) {
      onError(readApiErrorMessage(err, 'B-roll 应用失败'))
    } finally {
      setBrollBusySegmentId(null)
      setBrollApplyProgress(null)
    }
  }

  const segmentHasTts = (segment: VoiceoverSegment) =>
    Boolean(segment.tts?.duration_sec && segment.tts.duration_sec > 0)

  const canRerunSegmentTts = (segment: VoiceoverSegment) =>
    !isEditable &&
    (segment.status === 'failed' ||
      ((segment.status === 'tts_done' || segment.status === 'broll_done') && segmentHasTts(segment)))

  const rerunnableSegmentIds = useMemo(
    () =>
      plan?.segments
        .filter(
          (segment) =>
            segment.status === 'tts_done' ||
            segment.status === 'broll_done' ||
            (segment.status === 'failed' && segmentHasTts(segment))
        )
        .map((segment) => segment.id) ?? [],
    [plan]
  )

  const hasRerunnableTts = Boolean(canExecute && rerunnableSegmentIds.length > 0)

  const canManageBroll = (segment: VoiceoverSegment) =>
    !isEditable &&
    segmentHasTts(segment) &&
    ['tts_done', 'broll_done', 'failed'].includes(segment.status)

  const handleRemoveSegment = async (segmentId: string) => {
    if (!window.confirm('确定删除该分段？')) return
    setSaving(true)
    onError('')
    try {
      const response = await applyVoiceoverApi(() =>
        voiceoverApi.removeSegment(projectId, sessionId, segmentId)
      )
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

  const hasPendingTts = Boolean(
    plan &&
      canExecute &&
      plan.segments.some(
        (segment) =>
          segment.status === 'script_confirmed' ||
          (segment.status === 'failed' && !segmentHasTts(segment))
      )
  )

  const voiceGroups = useMemo(() => getEdgeTtsVoiceGroups(), [])
  const resolvedVoiceId = resolveEdgeTtsVoiceId(voiceId)

  return (
    <div className="editor-agent-panel__voiceover">
      <p className="editor-agent-panel__voiceover-intro">
        输入口播意图或完整文稿，生成分段脚本；确认后执行 TTS + 字幕上轨，可在时间线先试听；段落视频素材可后续再生成。
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
            value={resolvedVoiceId}
            onChange={(event) => setVoiceId(event.target.value)}
            disabled={loading || saving}
          >
            {voiceGroups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {formatEdgeTtsVoiceLabel(voice)}
                  </option>
                ))}
              </optgroup>
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

          {hasPendingTts ? (
            <div className="editor-agent-panel__voiceover-next-step" role="status">
              <strong>脚本已确认</strong>
              <p>
                无需上传参考图。字幕将默认显示在视频底部居中。点击「执行 TTS +
                字幕」即可将音频与字幕插入时间线试听；如需占位画面，可在下方可选设置。
              </p>
            </div>
          ) : null}

          {canExecute ? (
            <div className="editor-agent-panel__voiceover-execute">
              <label className="editor-agent-panel__voiceover-field">
                <span>占位视频（可选，素材库）</span>
                <select
                  className="editor-agent-panel__voiceover-select"
                  value={placeholderAssetId}
                  onChange={(event) => setPlaceholderAssetId(event.target.value)}
                  disabled={executing || saving}
                >
                  <option value="">不插入占位视频，仅音频 + 字幕</option>
                  {libraryAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.title}
                      {asset.duration_sec ? ` · ${Math.round(asset.duration_sec)}s` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {hasPendingTts ? (
                <button
                  type="button"
                  className="editor-agent-panel__voiceover-btn editor-agent-panel__voiceover-btn--primary"
                  onClick={() => void handleExecuteAll()}
                  disabled={executing || saving}
                >
                  {executing ? '执行中…' : '执行 TTS + 字幕（全部待处理段）'}
                </button>
              ) : hasRerunnableTts ? (
                <button
                  type="button"
                  className="editor-agent-panel__voiceover-btn editor-agent-panel__voiceover-btn--primary"
                  onClick={() => void handleRerunAll()}
                  disabled={executing || saving}
                >
                  {executing ? '重跑中…' : `重跑全部 TTS + 字幕（${rerunnableSegmentIds.length} 段）`}
                </button>
              ) : (
                <p className="editor-agent-panel__voiceover-segment-meta" role="status">
                  暂无可重跑段落。请先确认脚本后执行，或对失败段点击「重试 TTS」。
                </p>
              )}
            </div>
          ) : null}

          <div className="editor-agent-panel__voiceover-segments">
            {plan.segments.map((segment) => (
              <article key={segment.id} className="editor-agent-panel__voiceover-segment">
                <header className="editor-agent-panel__voiceover-segment-head">
                  <span>
                    第 {segment.index} 段
                    {!isEditable ? (
                      <span className="editor-agent-panel__voiceover-segment-status">
                        {VOICEOVER_SEGMENT_STATUS_LABEL[segment.status] ?? segment.status}
                      </span>
                    ) : null}
                  </span>
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

                <div className="editor-agent-panel__voiceover-field">
                  <span>素材搜索词（每行一个）</span>
                  <textarea
                    className="editor-agent-panel__voiceover-textarea"
                    rows={2}
                    value={getSearchQueriesText(segment)}
                    onChange={(event) => handleSearchQueriesChange(segment, event.target.value)}
                    onBlur={() => {
                      if (!isEditable && canEditSearchQueries(segment)) {
                        void persistSegmentSearchQueries(segment).catch((err: unknown) => {
                          onError(err instanceof Error ? err.message : '保存搜索词失败')
                        })
                      }
                    }}
                    disabled={!canEditSearchQueries(segment) || saving || translatingSegmentId === segment.id}
                    placeholder="例如：city night drone&#10;office desk typing"
                  />
                  {canEditSearchQueries(segment) ? (
                    <div className="editor-agent-panel__voiceover-translate">
                      <label className="editor-agent-panel__voiceover-translate-field">
                        <span className="editor-agent-panel__voiceover-translate-label">翻译为</span>
                        <select
                          className="editor-agent-panel__voiceover-select editor-agent-panel__voiceover-select--compact"
                          value={translateTargetLanguage}
                          onChange={(event) =>
                            setTranslateTargetLanguage(event.target.value as VoiceoverSearchQueryLanguage)
                          }
                          disabled={
                            loading ||
                            saving ||
                            Boolean(brollBusySegmentId) ||
                            translatingSegmentId === segment.id
                          }
                        >
                          {SEARCH_QUERY_LANGUAGES.map((lang) => (
                            <option key={lang.id} value={lang.id}>
                              {lang.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="editor-agent-panel__voiceover-btn editor-agent-panel__voiceover-btn--compact"
                        disabled={
                          loading ||
                          saving ||
                          Boolean(brollBusySegmentId) ||
                          translatingSegmentId === segment.id
                        }
                        onClick={() =>
                          void handleTranslateSearchQueries(segment, translateTargetLanguage)
                        }
                      >
                        {translatingSegmentId === segment.id ? '翻译中…' : '翻译'}
                      </button>
                    </div>
                  ) : null}
                </div>

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

                {canRerunSegmentTts(segment) ? (
                  <div className="editor-agent-panel__voiceover-segment-actions">
                    {segment.error ? (
                      <p className="editor-agent-panel__voiceover-segment-error">{segment.error}</p>
                    ) : null}
                    {segment.tts?.duration_sec ? (
                      <p className="editor-agent-panel__voiceover-segment-meta">
                        TTS {segment.tts.duration_sec.toFixed(1)}s
                        {segment.subtitles?.overlay_ids?.length
                          ? ` · ${segment.subtitles.overlay_ids.length} 条字幕`
                          : ''}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="editor-agent-panel__voiceover-btn"
                      onClick={() => void handleExecuteSegment(segment.id)}
                      disabled={executing || saving}
                    >
                      {segmentHasTts(segment)
                        ? '重新生成本段 TTS + 字幕'
                        : '重试 TTS'}
                    </button>
                  </div>
                ) : null}

                {canManageBroll(segment) ? (
                  <div className="editor-agent-panel__voiceover-broll">
                    <div className="editor-agent-panel__voiceover-broll-head">
                      <span>里程碑 C · 素材</span>
                      <select
                        className="editor-agent-panel__voiceover-select editor-agent-panel__voiceover-select--compact"
                        value={brollPlatform}
                        onChange={(event) =>
                          setBrollPlatform(event.target.value as 'youtube' | 'bilibili')
                        }
                        disabled={Boolean(brollBusySegmentId)}
                      >
                        <option value="youtube">YouTube</option>
                        <option value="bilibili">Bilibili</option>
                      </select>
                      <button
                        type="button"
                        className="editor-agent-panel__voiceover-btn"
                        onClick={() => void handleSearchBroll(segment)}
                        disabled={Boolean(brollBusySegmentId) || executing}
                      >
                        {brollBusySegmentId === segment.id ? '搜索中…' : '搜索素材'}
                      </button>
                    </div>

                    {(segment.broll?.search_results?.length ?? 0) > 0 ? (
                      <ul className="editor-agent-panel__voiceover-broll-results">
                        {segment.broll!.search_results!.map((item, index) => {
                          const sourceUrl = (item.url || '').trim()
                          return (
                          <li key={`${item.url}-${index}`}>
                            <div className="editor-agent-panel__voiceover-broll-result">
                              <label className="editor-agent-panel__voiceover-broll-result-select">
                                <input
                                  type="radio"
                                  name={`broll-search-${segment.id}`}
                                  checked={selectedSearchIndex[segment.id] === index}
                                  onChange={() =>
                                    setSelectedSearchIndex((prev) => ({
                                      ...prev,
                                      [segment.id]: index,
                                    }))
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="editor-agent-panel__voiceover-broll-result-body"
                                disabled={!sourceUrl}
                                title={sourceUrl ? '在浏览器中打开原视频' : '无可用链接'}
                                onClick={() => {
                                  if (sourceUrl) void openExternalLink(sourceUrl)
                                }}
                              >
                                <strong>{item.title || '未命名'}</strong>
                                <span className="editor-agent-panel__voiceover-broll-result-meta">
                                  {item.platform}
                                  {item.duration_sec ? ` · ${Math.round(item.duration_sec)}s` : ''}
                                  {item.in_library ? ' · 已在库' : ''}
                                  {sourceUrl ? ' · 点击查看原视频' : ''}
                                </span>
                              </button>
                            </div>
                          </li>
                          )
                        })}
                      </ul>
                    ) : null}

                    <label className="editor-agent-panel__voiceover-field">
                      <span>或从素材库指定</span>
                      <select
                        className="editor-agent-panel__voiceover-select"
                        value={libraryPickBySegment[segment.id] ?? ''}
                        onChange={(event) =>
                          setLibraryPickBySegment((prev) => ({
                            ...prev,
                            [segment.id]: event.target.value,
                          }))
                        }
                        disabled={Boolean(brollBusySegmentId)}
                      >
                        <option value="">（可选）素材库视频…</option>
                        {libraryAssets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.title}
                            {asset.duration_sec ? ` · ${Math.round(asset.duration_sec)}s` : ''}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="editor-agent-panel__voiceover-broll-actions">
                      <button
                        type="button"
                        className="editor-agent-panel__voiceover-btn"
                        onClick={() => void handleSelectBroll(segment.id)}
                        disabled={Boolean(brollBusySegmentId) || executing}
                      >
                        {brollBusySegmentId === segment.id && !brollApplyProgress
                          ? '确认中…'
                          : '确认候选'}
                      </button>
                      <button
                        type="button"
                        className="editor-agent-panel__voiceover-btn editor-agent-panel__voiceover-btn--primary"
                        onClick={() => void handleApplyBroll(segment.id, false)}
                        disabled={Boolean(brollBusySegmentId) || executing || !segment.broll?.selected}
                      >
                        {brollBusySegmentId === segment.id && brollApplyProgress
                          ? `${VOICEOVER_BROLL_APPLY_STAGE_LABEL[brollApplyProgress.stage] ?? '处理中'}…`
                          : '下载并应用 B-roll'}
                      </button>
                    </div>

                    {brollApplyProgress?.segmentId === segment.id ? (
                      <div className="editor-agent-panel__voiceover-broll-progress">
                        <div className="editor-agent-panel__voiceover-broll-progress-head">
                          <span>
                            {VOICEOVER_BROLL_APPLY_STAGE_LABEL[brollApplyProgress.stage] ??
                              brollApplyProgress.stage}
                          </span>
                          <span>{Math.round(brollApplyProgress.progress)}%</span>
                        </div>
                        <div
                          className="editor-agent-panel__voiceover-broll-progress-bar"
                          role="progressbar"
                          aria-valuenow={Math.round(brollApplyProgress.progress)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="editor-agent-panel__voiceover-broll-progress-fill"
                            style={{ width: `${Math.min(100, Math.max(0, brollApplyProgress.progress))}%` }}
                          />
                        </div>
                        <p className="editor-agent-panel__voiceover-segment-meta">
                          {brollApplyProgress.message}
                          {brollApplyProgress.stage === 'analyzing'
                            ? '（画面分析可能需 1–3 分钟，请耐心等待）'
                            : null}
                        </p>
                      </div>
                    ) : null}

                    {segment.broll?.selected ? (
                      <p className="editor-agent-panel__voiceover-segment-meta">
                        已选：{segment.broll.selected.title}
                      </p>
                    ) : null}

                    {segment.broll?.selection_reason ? (
                      <p className="editor-agent-panel__voiceover-broll-reason">
                        {segment.broll.selection_reason}
                      </p>
                    ) : null}

                    <div className="editor-agent-panel__voiceover-broll-trim">
                      <label className="editor-agent-panel__voiceover-field editor-agent-panel__voiceover-field--inline">
                        <span>手动 in (s)</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          className="editor-agent-panel__voiceover-input"
                          value={
                            manualTrim[segment.id]?.inSec ??
                            (segment.broll?.source_in_sec != null
                              ? String(segment.broll.source_in_sec)
                              : '')
                          }
                          onChange={(event) =>
                            setManualTrim((prev) => ({
                              ...prev,
                              [segment.id]: {
                                inSec: event.target.value,
                                outSec: prev[segment.id]?.outSec ?? '',
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="editor-agent-panel__voiceover-field editor-agent-panel__voiceover-field--inline">
                        <span>手动 out (s)</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          className="editor-agent-panel__voiceover-input"
                          value={
                            manualTrim[segment.id]?.outSec ??
                            (segment.broll?.source_out_sec != null
                              ? String(segment.broll.source_out_sec)
                              : '')
                          }
                          onChange={(event) =>
                            setManualTrim((prev) => ({
                              ...prev,
                              [segment.id]: {
                                inSec: prev[segment.id]?.inSec ?? '',
                                outSec: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="editor-agent-panel__voiceover-btn"
                        onClick={() => void handleApplyBroll(segment.id, true)}
                        disabled={Boolean(brollBusySegmentId) || executing || !segment.broll?.selected}
                      >
                        应用手动 trim
                      </button>
                    </div>
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
              disabled={saving || executing}
            >
              删除计划
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

export default VoiceoverPlanPanel
