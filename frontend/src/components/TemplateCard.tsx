import React from 'react'
import { Card, Typography, Button, Tag } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import type { GeneTemplateSummary } from '../services/api'
import { resolveApiMediaUrl } from '../services/api'

const { Text, Paragraph } = Typography

interface TemplateCardProps {
  template: GeneTemplateSummary
  onSelect: (template: GeneTemplateSummary) => void
}

const TemplateCard: React.FC<TemplateCardProps> = ({ template, onSelect }) => {
  const videoUrl = resolveApiMediaUrl(template.preview.video_url)
  const thumbnailUrl = resolveApiMediaUrl(template.preview.thumbnail_url)
  const coverUrl = videoUrl || thumbnailUrl

  return (
    <Card
      hoverable
      style={{
        borderRadius: '16px',
        border: '1px solid var(--ac-line)',
        background: 'var(--ac-card)',
        overflow: 'hidden',
        height: '100%',
      }}
      styles={{ body: { padding: '16px' } }}
      cover={
        <div
          style={{
            height: '168px',
            background: 'var(--ac-thumb)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {coverUrl ? (
            videoUrl ? (
              <video
                src={videoUrl}
                poster={thumbnailUrl || undefined}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                muted
                autoPlay
                loop
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                src={thumbnailUrl}
                alt={template.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )
          ) : (
            <PlayCircleOutlined style={{ fontSize: '36px', color: 'var(--ac-muted)' }} />
          )}
        </div>
      }
    >
      <div style={{ marginBottom: '8px' }}>
        <Text strong style={{ fontSize: '15px', color: 'var(--ac-ink)' }}>
          {template.name}
        </Text>
      </div>
      <Paragraph
        ellipsis={{ rows: 2 }}
        style={{ color: 'var(--ac-sub)', fontSize: '13px', marginBottom: '12px', minHeight: '40px' }}
      >
        {template.description}
      </Paragraph>
      {template.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
          {template.tags.map((tag) => (
            <Tag
              key={tag}
              style={{
                margin: 0,
                borderRadius: '999px',
                border: '1px solid var(--ac-line)',
                background: 'var(--ac-line-2)',
                color: 'var(--ac-sub)',
                fontSize: '12px',
              }}
            >
              {tag}
            </Tag>
          ))}
        </div>
      )}
      <Button
        type="primary"
        block
        onClick={() => onSelect(template)}
        style={{
          background: 'var(--ac-cta-bg)',
          color: 'var(--ac-cta-fg)',
          border: 'none',
          borderRadius: '999px',
          height: '40px',
          fontWeight: 500,
        }}
      >
        使用此模板
      </Button>
    </Card>
  )
}

export default TemplateCard
