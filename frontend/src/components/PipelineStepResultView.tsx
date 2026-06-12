import React from 'react'
import { PipelineStepResultResponse } from '../services/api'

interface PipelineStepResultViewProps {
  result: PipelineStepResultResponse
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

const OutlineListView: React.FC<{ result: PipelineStepResultResponse }> = ({ result }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {result.items.map((item, i) => {
      const subtopics = (item.subtopics as string[] | undefined) ?? []
      return (
        <div key={i} style={cardStyle}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)' }}>{String(item.index ?? i + 1)}</span>
            <span style={{ fontSize: 13, color: 'var(--ac-ink)', fontWeight: 500, flex: 1 }}>
              {String(item.title ?? '')}
            </span>
            {item.chunk_index != null ? (
              <span style={{ fontSize: 11, color: 'var(--ac-muted)' }}>块 {String(item.chunk_index)}</span>
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
        </div>
      )
    })}
  </div>
)

const TimelineListView: React.FC<{ result: PipelineStepResultResponse }> = ({ result }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {result.items.map((item, i) => (
      <div key={i} style={cardStyle}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          {item.id != null ? (
            <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)' }}>#{String(item.id)}</span>
          ) : null}
          <span style={{ fontSize: 13, color: 'var(--ac-ink)', fontWeight: 500, flex: 1, minWidth: 120 }}>
            {String(item.title ?? '')}
          </span>
          <span style={{ ...mono, fontSize: 12, color: 'var(--ac-sub)' }}>
            {formatTime(item.start_time)} → {formatTime(item.end_time)}
          </span>
        </div>
      </div>
    ))}
  </div>
)

const ScoreListView: React.FC<{ result: PipelineStepResultResponse }> = ({ result }) => {
  const threshold = Number(result.meta?.threshold ?? 0.7)
  const highCount = Number(result.meta?.high_score_count ?? 0)
  const totalCount = Number(result.meta?.total_count ?? result.items.length)

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--ac-muted)', marginBottom: 10 }}>
        共 {totalCount} 条评分 · 阈值 {threshold.toFixed(2)} · 通过 {highCount} 条
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {result.items.map((item, i) => {
          const passed = Boolean(item.passed)
          return (
            <div
              key={i}
              style={{
                ...cardStyle,
                opacity: passed ? 1 : 0.72,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                {item.id != null ? (
                  <span style={{ ...mono, fontSize: 11, color: 'var(--ac-muted)' }}>#{String(item.id)}</span>
                ) : null}
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
                </span>
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

const PipelineStepResultView: React.FC<PipelineStepResultViewProps> = ({ result }) => {
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
      return <OutlineListView result={result} />
    case 'timeline_list':
      return <TimelineListView result={result} />
    case 'score_list':
      return <ScoreListView result={result} />
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
