import React, { useState } from 'react'
import { Button, Input, InputNumber, Space, Switch, message } from 'antd'
import { PipelineStepResultResponse, projectApi } from '../services/api'
import TimelinePreviewModal, { TimelinePreviewItem } from './TimelinePreviewModal'
import { formatSrtTimeDisplay, isValidSrtTime } from '../utils/srtTime'

interface PipelineStepResultViewProps {
  result: PipelineStepResultResponse
  projectId?: string
  sourceId?: string | null
  onOutlineItemSaved?: (itemIndex: number, item: Record<string, unknown>) => void
  onTimelineItemSaved?: (itemId: string, item: Record<string, unknown>) => void
  onScoreItemSaved?: (itemId: string, item: Record<string, unknown>, highScoreCount: number) => void
}

const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontVariantNumeric: 'tabular-nums',
}

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--ac-line)',
  background: 'var(--ac-bg, var(--bg))',
}

const formatTime = (time?: unknown) => {
  if (!time) return '—'
  return String(time).replace(',', '.').substring(0, 12)
}

const formatScore = (score?: unknown) => {
  if (score == null || score === '') return '—'
  const n = Number(score)
  if (Number.isNaN(n)) return String(score)
  return n.toFixed(2)
}

const MediaInfoView: React.FC<{ result: PipelineStepResultResponse }> = ({ result }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {result.items.map((item, i) => (
      <div key={i} style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, color: 'var(--ac-ink)', fontWeight: 500 }}>
            {String(item.label ?? '')}
          </span>
          <span
            style={{
              fontSize: 11,
              color: item.ready ? 'var(--ok)' : 'var(--ac-muted)',
              flexShrink: 0,
            }}
          >
            {item.ready ? '就绪' : '未就绪'}
          </span>
        </div>
        <div style={{ ...mono, fontSize: 12, color: 'var(--ac-sub)', marginTop: 6, wordBreak: 'break-all' }}>
          {String(item.path ?? '')}
        </div>
        {item.detail ? (
          <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginTop: 4 }}>{String(item.detail)}</div>
        ) : null}
      </div>
    ))}
  </div>
)

const OutlineListView: React.FC<{
  result: PipelineStepResultResponse
  projectId?: string
  sourceId?: string | null
  onOutlineItemSaved?: (itemIndex: number, item: Record<string, unknown>) => void
}> = ({ result, projectId, sourceId, onOutlineItemSaved }) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftSubtopics, setDraftSubtopics] = useState('')
  const [draftChunkIndex, setDraftChunkIndex] = useState<number | null>(null)
  const [savingIndex, setSavingIndex] = useState<number | null>(null)

  const canEdit = Boolean(projectId)

  const startEdit = (item: Record<string, unknown>, displayIndex: number) => {
    const subtopics = (item.subtopics as string[] | undefined) ?? []
    setEditingIndex(displayIndex)
    setDraftTitle(String(item.title ?? ''))
    setDraftSubtopics(subtopics.join('\n'))
    setDraftChunkIndex(
      item.chunk_index == null || item.chunk_index === ''
        ? null
        : Number(item.chunk_index)
    )
  }

  const cancelEdit = () => {
    setEditingIndex(null)
    setDraftTitle('')
    setDraftSubtopics('')
    setDraftChunkIndex(null)
  }

  const saveEdit = async (displayIndex: number) => {
    if (!projectId) return
    const title = draftTitle.trim()
    if (!title) {
      message.warning('标题不能为空')
      return
    }
    const subtopics = draftSubtopics
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    setSavingIndex(displayIndex)
    try {
      const res = await projectApi.updatePipelineOutlineItem(
        projectId,
        displayIndex,
        {
          title,
          subtopics,
          chunk_index: draftChunkIndex ?? undefined,
        },
        sourceId
      )
      message.success('已保存')
      onOutlineItemSaved?.(displayIndex, res.item as Record<string, unknown>)
      cancelEdit()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '保存失败')
    } finally {
      setSavingIndex(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {canEdit ? (
        <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 2 }}>
          可直接修改每条大纲/金句，保存后请从 Step 2 重新执行以更新后续步骤。
        </div>
      ) : null}
      {result.items.map((item, i) => {
        const displayIndex = Number(item.index ?? i + 1)
        const subtopics = (item.subtopics as string[] | undefined) ?? []
        const isEditing = editingIndex === displayIndex
        const isSaving = savingIndex === displayIndex

        return (
          <div key={displayIndex} style={cardStyle}>
            {isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>
                    标题
                  </div>
                  <Input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="话题或金句标题"
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>
                    要点（每行一条，首条通常是核心原话）
                  </div>
                  <Input.TextArea
                    value={draftSubtopics}
                    onChange={(e) => setDraftSubtopics(e.target.value)}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    placeholder="每行一个要点"
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>
                    SRT 分块
                  </div>
                  <InputNumber
                    min={0}
                    value={draftChunkIndex}
                    onChange={(value) => setDraftChunkIndex(value == null ? null : Number(value))}
                    style={{ width: 120 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    type="primary"
                    size="small"
                    loading={isSaving}
                    onClick={() => saveEdit(displayIndex)}
                  >
                    保存
                  </Button>
                  <Button size="small" onClick={cancelEdit} disabled={isSaving}>
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)' }}>
                    {String(displayIndex)}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ac-ink)', fontWeight: 500, flex: 1 }}>
                    {String(item.title ?? '')}
                  </span>
                  {item.chunk_index != null ? (
                    <span style={{ fontSize: 11, color: 'var(--ac-muted)' }}>
                      块 {String(item.chunk_index)}
                    </span>
                  ) : null}
                  {canEdit ? (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: 'auto', fontSize: 12 }}
                      onClick={() => startEdit(item, displayIndex)}
                    >
                      编辑
                    </Button>
                  ) : null}
                </div>
                {subtopics.length > 0 ? (
                  <ul
                    style={{
                      margin: '8px 0 0',
                      paddingLeft: 18,
                      fontSize: 12,
                      color: 'var(--ac-sub)',
                      lineHeight: 1.6,
                    }}
                  >
                    {subtopics.map((sub, j) => (
                      <li key={j}>{sub}</li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginTop: 6 }}>无子话题</div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

const outlineFromItem = (item: Record<string, unknown>): string => {
  const outline = item.outline
  if (typeof outline === 'string' && outline.trim()) return outline.trim()
  if (outline && typeof outline === 'object' && 'title' in (outline as object)) {
    return String((outline as { title?: string }).title || '').trim()
  }
  return String(item.title ?? '').trim()
}

const TimelineListView: React.FC<{
  result: PipelineStepResultResponse
  projectId?: string
  sourceId?: string | null
  onTimelineItemSaved?: (itemId: string, item: Record<string, unknown>) => void
}> = ({ result, projectId, sourceId, onTimelineItemSaved }) => {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftOutline, setDraftOutline] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [previewItem, setPreviewItem] = useState<TimelinePreviewItem | null>(null)

  const canEdit = Boolean(projectId)

  const startEdit = (item: Record<string, unknown>) => {
    const id = String(item.id ?? '')
    setEditingId(id)
    setDraftOutline(outlineFromItem(item))
    setDraftContent(((item.content as string[] | undefined) ?? []).join('\n'))
    setDraftStart(String(item.start_time ?? ''))
    setDraftEnd(String(item.end_time ?? ''))
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = async (itemId: string) => {
    if (!projectId) return
    const outline = draftOutline.trim()
    if (!outline) {
      message.warning('标题不能为空')
      return
    }
    if (!isValidSrtTime(draftStart) || !isValidSrtTime(draftEnd)) {
      message.warning('时间格式应为 HH:MM:SS,mmm')
      return
    }

    const content = draftContent
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    setSavingId(itemId)
    try {
      const res = await projectApi.updatePipelineTimelineItem(
        projectId,
        itemId,
        {
          outline,
          content,
          start_time: draftStart.trim(),
          end_time: draftEnd.trim(),
        },
        sourceId
      )
      message.success('已保存')
      onTimelineItemSaved?.(itemId, res.item as Record<string, unknown>)
      cancelEdit()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '保存失败')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {canEdit ? (
          <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 2 }}>
            可编辑每条时间线，或用「预览校准」对照原片调整入点/出点。保存后请从 Step 3 重新执行。
          </div>
        ) : null}
        {result.items.map((item, i) => {
          const itemId = String(item.id ?? i + 1)
          const isEditing = editingId === itemId
          const isSaving = savingId === itemId
          const content = (item.content as string[] | undefined) ?? []

          return (
            <div key={itemId} style={cardStyle}>
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>标题</div>
                    <Input value={draftOutline} onChange={(e) => setDraftOutline(e.target.value)} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>要点</div>
                    <Input.TextArea
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                    />
                  </div>
                  <Space wrap>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>入点</div>
                      <Input
                        value={draftStart}
                        onChange={(e) => setDraftStart(e.target.value)}
                        style={{ width: 160, ...mono, fontSize: 12 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>出点</div>
                      <Input
                        value={draftEnd}
                        onChange={(e) => setDraftEnd(e.target.value)}
                        style={{ width: 160, ...mono, fontSize: 12 }}
                      />
                    </div>
                  </Space>
                  <Space>
                    <Button type="primary" size="small" loading={isSaving} onClick={() => saveEdit(itemId)}>
                      保存
                    </Button>
                    <Button size="small" onClick={cancelEdit} disabled={isSaving}>
                      取消
                    </Button>
                  </Space>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)' }}>#{itemId}</span>
                    <span style={{ fontSize: 13, color: 'var(--ac-ink)', fontWeight: 500, flex: 1, minWidth: 120 }}>
                      {String(item.title ?? outlineFromItem(item))}
                    </span>
                    <span style={{ ...mono, fontSize: 12, color: 'var(--ac-sub)' }}>
                      {formatSrtTimeDisplay(item.start_time)} → {formatSrtTimeDisplay(item.end_time)}
                    </span>
                    {canEdit ? (
                      <Space size={4}>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto', fontSize: 12 }}
                          onClick={() => startEdit(item)}
                        >
                          编辑
                        </Button>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto', fontSize: 12 }}
                          onClick={() =>
                            setPreviewItem({
                              id: itemId,
                              title: String(item.title ?? ''),
                              outline: item.outline ?? item.title,
                              content,
                              start_time: String(item.start_time ?? ''),
                              end_time: String(item.end_time ?? ''),
                            })
                          }
                        >
                          预览校准
                        </Button>
                      </Space>
                    ) : null}
                  </div>
                  {content.length > 0 ? (
                    <ul
                      style={{
                        margin: '8px 0 0',
                        paddingLeft: 18,
                        fontSize: 12,
                        color: 'var(--ac-sub)',
                        lineHeight: 1.6,
                      }}
                    >
                      {content.slice(0, 3).map((line, j) => (
                        <li key={j}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </div>
          )
        })}
      </div>

      {projectId ? (
        <TimelinePreviewModal
          open={Boolean(previewItem)}
          projectId={projectId}
          sourceId={sourceId}
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onSaved={(itemId, saved) => {
            onTimelineItemSaved?.(itemId, saved)
            setPreviewItem(null)
          }}
        />
      ) : null}
    </>
  )
}

const ScoreListView: React.FC<{
  result: PipelineStepResultResponse
  projectId?: string
  sourceId?: string | null
  onScoreItemSaved?: (itemId: string, item: Record<string, unknown>, highScoreCount: number) => void
}> = ({ result, projectId, sourceId, onScoreItemSaved }) => {
  const threshold = Number(result.meta?.threshold ?? 0.7)
  const highCount = Number(result.meta?.high_score_count ?? 0)
  const totalCount = Number(result.meta?.total_count ?? result.items.length)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftScore, setDraftScore] = useState<number | null>(null)
  const [draftReason, setDraftReason] = useState('')
  const [draftPassed, setDraftPassed] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const canEdit = Boolean(projectId)

  const startEdit = (item: Record<string, unknown>) => {
    const id = String(item.id ?? '')
    setEditingId(id)
    setDraftScore(item.score == null ? 0 : Number(item.score))
    setDraftReason(String(item.recommend_reason ?? ''))
    setDraftPassed(Boolean(item.passed))
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = async (itemId: string) => {
    if (!projectId) return
    if (draftScore == null || Number.isNaN(draftScore)) {
      message.warning('请填写有效评分')
      return
    }
    if (draftScore < 0 || draftScore > 1) {
      message.warning('评分须在 0–1 之间')
      return
    }
    const recommendReason = draftReason.trim()
    if (!recommendReason) {
      message.warning('推荐理由不能为空')
      return
    }

    setSavingId(itemId)
    try {
      const res = await projectApi.updatePipelineScoreItem(
        projectId,
        itemId,
        {
          final_score: draftScore,
          recommend_reason: recommendReason,
          passed: draftPassed,
        },
        sourceId
      )
      message.success('已保存')
      onScoreItemSaved?.(itemId, res.item as Record<string, unknown>, res.high_score_count)
      cancelEdit()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '保存失败')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 10 }}>
        共 {totalCount} 条评分 · 阈值 {threshold.toFixed(2)} · 通过 {highCount} 条
      </div>
      {canEdit ? (
        <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 10 }}>
          可修改评分、推荐理由，或手动设为通过/未通过。保存后请从 Step 5 重新执行。
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {result.items.map((item, i) => {
          const itemId = String(item.id ?? i + 1)
          const passed = Boolean(item.passed)
          const isEditing = editingId === itemId
          const isSaving = savingId === itemId
          const manualPassed = item.manual_passed

          return (
            <div
              key={itemId}
              style={{
                ...cardStyle,
                opacity: passed ? 1 : 0.72,
              }}
            >
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, color: 'var(--ac-ink)', fontWeight: 500 }}>
                    {String(item.title ?? '')}
                  </div>
                  <Space wrap align="center">
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>评分</div>
                      <InputNumber
                        min={0}
                        max={1}
                        step={0.01}
                        value={draftScore}
                        onChange={(v) => setDraftScore(v)}
                        style={{ width: 100 }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>通过</div>
                      <Switch checked={draftPassed} onChange={setDraftPassed} />
                    </div>
                  </Space>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 4 }}>推荐理由</div>
                    <Input.TextArea
                      value={draftReason}
                      onChange={(e) => setDraftReason(e.target.value)}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                    />
                  </div>
                  <Space>
                    <Button type="primary" size="small" loading={isSaving} onClick={() => saveEdit(itemId)}>
                      保存
                    </Button>
                    <Button size="small" onClick={cancelEdit} disabled={isSaving}>
                      取消
                    </Button>
                  </Space>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)' }}>#{itemId}</span>
                    <span style={{ fontSize: 13, color: 'var(--ac-ink)', fontWeight: 500, flex: 1, minWidth: 120 }}>
                      {String(item.title ?? '')}
                    </span>
                    <span
                      style={{
                        ...mono,
                        fontSize: 13,
                        fontWeight: 600,
                        color: passed ? 'var(--ac-ink)' : 'var(--ac-muted)',
                      }}
                    >
                      {formatScore(item.score)}
                    </span>
                    <span style={{ fontSize: 11, color: passed ? 'var(--ok)' : 'var(--ac-muted)' }}>
                      {passed ? '通过' : '未通过'}
                      {manualPassed === true || manualPassed === false ? ' · 手动' : ''}
                    </span>
                    {canEdit ? (
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0, height: 'auto', fontSize: 12 }}
                        onClick={() => startEdit(item)}
                      >
                        编辑
                      </Button>
                    ) : null}
                  </div>
                  {item.recommend_reason ? (
                    <div style={{ fontSize: 12, color: 'var(--ac-sub)', marginTop: 8, lineHeight: 1.55 }}>
                      {String(item.recommend_reason)}
                    </div>
                  ) : null}
                  <div style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)', marginTop: 6 }}>
                    {formatTime(item.start_time)} → {formatTime(item.end_time)}
                  </div>
                  {item.content_preview ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--ac-muted)',
                        marginTop: 8,
                        lineHeight: 1.55,
                        borderTop: '1px solid var(--ac-line)',
                        paddingTop: 8,
                      }}
                    >
                      {String(item.content_preview)}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const TitleListView: React.FC<{ result: PipelineStepResultResponse }> = ({ result }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {result.items.map((item, i) => (
      <div key={i} style={cardStyle}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          {item.id != null ? (
            <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)' }}>#{String(item.id)}</span>
          ) : null}
          {item.score != null ? (
            <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)' }}>{formatScore(item.score)}</span>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginTop: 6 }}>原始话题</div>
        <div style={{ fontSize: 13, color: 'var(--ac-sub)', marginTop: 2, lineHeight: 1.5 }}>
          {String(item.original_title ?? '')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginTop: 10 }}>生成标题</div>
        <div style={{ fontSize: 14, color: 'var(--ac-ink)', fontWeight: 500, marginTop: 2, lineHeight: 1.5 }}>
          {String(item.generated_title ?? '')}
        </div>
        {item.recommend_reason ? (
          <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginTop: 8, lineHeight: 1.55 }}>
            {String(item.recommend_reason)}
          </div>
        ) : null}
      </div>
    ))}
  </div>
)

const CollectionListView: React.FC<{ result: PipelineStepResultResponse }> = ({ result }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {result.items.map((item, i) => {
      const clipIds = (item.clip_ids as string[] | undefined) ?? []
      return (
        <div key={i} style={cardStyle}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            {item.id != null ? (
              <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)' }}>#{String(item.id)}</span>
            ) : null}
            <span style={{ fontSize: 14, color: 'var(--ac-ink)', fontWeight: 500, flex: 1 }}>
              {String(item.title ?? '')}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ac-muted)' }}>{clipIds.length} 切片</span>
          </div>
          {item.summary ? (
            <div style={{ fontSize: 12, color: 'var(--ac-sub)', marginTop: 8, lineHeight: 1.55 }}>
              {String(item.summary)}
            </div>
          ) : null}
          {clipIds.length > 0 ? (
            <div style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)', marginTop: 8 }}>
              包含切片：{clipIds.join(' · ')}
            </div>
          ) : null}
        </div>
      )
    })}
  </div>
)

const ExportSummaryView: React.FC<{ result: PipelineStepResultResponse }> = ({ result }) => {
  const clips = result.items.filter((item) => item.type === 'clip')
  const collections = result.items.filter((item) => item.type === 'collection')

  return (
    <div>
      {result.summary ? (
        <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 10 }}>
          已导出 {result.summary.clips_generated ?? clips.length} 个切片 ·{' '}
          {result.summary.collections_generated ?? collections.length} 个合集
        </div>
      ) : null}
      {clips.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--ac-sub)', fontWeight: 500, marginBottom: 8 }}>切片文件</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {clips.map((item, i) => (
              <div key={i} style={{ ...cardStyle, padding: '8px 10px' }}>
                <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)', marginRight: 8 }}>
                  {String(item.index ?? i + 1)}
                </span>
                <span style={{ ...mono, fontSize: 12, color: 'var(--ac-sub)', wordBreak: 'break-all' }}>
                  {String(item.path ?? '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {collections.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, color: 'var(--ac-sub)', fontWeight: 500, marginBottom: 8 }}>合集文件</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {collections.map((item, i) => (
              <div key={i} style={cardStyle}>
                <div style={{ fontSize: 13, color: 'var(--ac-ink)', fontWeight: 500 }}>
                  {String(item.title ?? `合集 ${i + 1}`)}
                </div>
                <div style={{ ...mono, fontSize: 12, color: 'var(--ac-sub)', marginTop: 6, wordBreak: 'break-all' }}>
                  {String(item.path ?? '')}
                </div>
                {item.clip_count != null ? (
                  <div style={{ fontSize: 11, color: 'var(--ac-muted)', marginTop: 4 }}>
                    含 {String(item.clip_count)} 个切片
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const PipelineStepResultView: React.FC<PipelineStepResultViewProps> = ({
  result,
  projectId,
  sourceId,
  onOutlineItemSaved,
  onTimelineItemSaved,
  onScoreItemSaved,
}) => {
  if (!result.available) {
    return (
      <div style={{ fontSize: 12, color: 'var(--ac-muted)', padding: '4px 0' }}>
        {result.message || '暂无结果可查看'}
      </div>
    )
  }

  switch (result.result_type) {
    case 'media_info':
      return <MediaInfoView result={result} />
    case 'outline_list':
      return (
        <OutlineListView
          result={result}
          projectId={projectId}
          sourceId={sourceId}
          onOutlineItemSaved={onOutlineItemSaved}
        />
      )
    case 'timeline_list':
      return (
        <TimelineListView
          result={result}
          projectId={projectId}
          sourceId={sourceId}
          onTimelineItemSaved={onTimelineItemSaved}
        />
      )
    case 'score_list':
      return (
        <ScoreListView
          result={result}
          projectId={projectId}
          sourceId={sourceId}
          onScoreItemSaved={onScoreItemSaved}
        />
      )
    case 'title_list':
      return <TitleListView result={result} />
    case 'collection_list':
      return <CollectionListView result={result} />
    case 'export_summary':
      return <ExportSummaryView result={result} />
    default:
      return (
        <div style={{ fontSize: 12, color: 'var(--ac-muted)' }}>
          暂不支持展示此类型结果
        </div>
      )
  }
}

export default PipelineStepResultView
