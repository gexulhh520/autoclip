import React from 'react'
import { Button } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons'
import type { ProjectSourceSummary } from '../services/api'

const statusLabel: Record<ProjectSourceSummary['status'], string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
}

interface ProjectSourcesPanelProps {
  sources: ProjectSourceSummary[]
  selectedSourceId: string | null
  activeSourceId?: string | null
  onSelect: (sourceId: string | null) => void
  onRetry?: (sourceId: string) => void
  retryingSourceId?: string | null
}

const ProjectSourcesPanel: React.FC<ProjectSourcesPanelProps> = ({
  sources,
  selectedSourceId,
  activeSourceId,
  onSelect,
  onRetry,
  retryingSourceId,
}) => {
  if (sources.length === 0) return null

  const renderIcon = (status: ProjectSourceSummary['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircleOutlined style={{ color: 'var(--ok)' }} />
      case 'processing':
        return <LoadingOutlined style={{ color: 'var(--accent)' }} />
      case 'failed':
        return <CloseCircleOutlined style={{ color: 'var(--error)' }} />
      default:
        return <MinusCircleOutlined style={{ color: 'var(--muted)' }} />
    }
  }

  return (
    <div
      style={{
        borderRadius: 16,
        border: '1px solid var(--ac-line)',
        background: 'var(--ac-card)',
        padding: '16px 18px',
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ac-ink)', marginBottom: 12 }}>
        源视频
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          onClick={() => onSelect(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 10,
            border: selectedSourceId === null ? '1px solid var(--ac-ink)' : '1px solid var(--ac-line)',
            background: selectedSourceId === null ? 'var(--ac-line-2)' : 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--ac-ink)' }}>全部片段</span>
          <span style={{ fontSize: 12, color: 'var(--ac-sub)' }}>
            {sources.reduce((sum, s) => sum + (s.clips_count || 0), 0)} 个
          </span>
        </button>

        {sources.map((source) => {
          const isSelected = selectedSourceId === source.id
          const isActive = activeSourceId === source.id
          return (
            <div
              key={source.id}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(source.id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: isSelected ? '1px solid var(--ac-ink)' : '1px solid var(--ac-line)',
                  background: isSelected ? 'var(--ac-line-2)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {renderIcon(source.status)}
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--ac-ink)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 220,
                      }}
                    >
                      {source.index + 1}. {source.original_filename}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ac-sub)', marginTop: 2 }}>
                      {statusLabel[source.status]}
                      {isActive ? ' · 当前' : ''}
                      {source.clips_count ? ` · ${source.clips_count} 片段` : ''}
                      {source.current_step ? ` · ${source.current_step}` : ''}
                    </div>
                  </div>
                </div>
              </button>
              {source.status === 'failed' && onRetry ? (
                <Button
                  size="small"
                  loading={retryingSourceId === source.id}
                  onClick={() => onRetry(source.id)}
                  style={{ alignSelf: 'center', borderRadius: 8 }}
                >
                  重试
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ProjectSourcesPanel
