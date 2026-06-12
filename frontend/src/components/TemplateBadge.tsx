import React from 'react'
import { Tag } from 'antd'
import { getProjectTemplateId, getTemplateLabel } from '../utils/geneTemplate'

interface TemplateBadgeProps {
  project: {
    settings?: Record<string, unknown> | null
    processing_config?: Record<string, unknown> | null
  }
  style?: React.CSSProperties
}

const TemplateBadge: React.FC<TemplateBadgeProps> = ({ project, style }) => {
  const templateId = getProjectTemplateId(project)
  if (!templateId) return null

  return (
    <Tag
      style={{
        margin: 0,
        borderRadius: '999px',
        border: '1px solid var(--ac-line)',
        background: 'var(--ac-line-2)',
        color: 'var(--ac-sub)',
        fontSize: '12px',
        ...style,
      }}
    >
      模板 · {getTemplateLabel(templateId)}
    </Tag>
  )
}

export default TemplateBadge
