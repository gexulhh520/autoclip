import React from 'react'
import { PlusOutlined } from '@ant-design/icons'

interface AssetPresetCardProps {
  name: string
  preview: React.ReactNode
  onAdd: () => void
  aspectRatio?: number
}

/** OpenCut DraggableItem 风格：点击添加到时间线 */
const AssetPresetCard: React.FC<AssetPresetCardProps> = ({
  name,
  preview,
  onAdd,
  aspectRatio = 1,
}) => (
  <div className="editor-asset-preset-card">
    <button type="button" className="editor-asset-preset-card__body" onClick={onAdd}>
      <div
        className="editor-asset-preset-card__preview"
        style={{ aspectRatio: String(aspectRatio) }}
      >
        {preview}
      </div>
      <span className="editor-asset-preset-card__label">{name}</span>
    </button>
    <button
      type="button"
      className="editor-asset-preset-card__add"
      title="添加到播放头"
      aria-label={`添加 ${name}`}
      onClick={onAdd}
    >
      <PlusOutlined />
    </button>
  </div>
)

export default AssetPresetCard
