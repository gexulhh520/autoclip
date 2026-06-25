import React from 'react'
import { message } from 'antd'
import type { AudioAssetMeta, EditSession } from '../../../../../types/editSession'

export interface AudioAssetLibraryProps {
  session: EditSession
  assets: AudioAssetMeta[]
  emptyHint: string
  addLabel?: string
  onAdd: (assetId: string) => string | null | void
  onRemove: (assetId: string) => void
}

const AudioAssetLibrary: React.FC<AudioAssetLibraryProps> = ({
  session,
  assets,
  emptyHint,
  addLabel = '添加',
  onAdd,
  onRemove,
}) => {
  if (assets.length === 0) {
    return <div className="editor-empty-hint">{emptyHint}</div>
  }

  return (
    <div className="editor-clip-list">
      {assets.map((asset) => {
        const usedOnTimeline = (session.audio_elements ?? []).some(
          (item) => item.asset_id === asset.id
        )
        const durationLabel =
          asset.duration_sec != null ? `${asset.duration_sec.toFixed(1)}s` : null
        return (
          <div
            key={asset.id}
            className="editor-clip-item editor-clip-item--audio"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-autoclip-audio-asset', asset.id)
              event.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <div className="editor-clip-meta" style={{ flex: 1 }}>
              <div className="editor-clip-title">{asset.name}</div>
              <div className="editor-clip-sub">
                {usedOnTimeline ? '已在时间线' : '拖入音频轨或添加'}
                {durationLabel ? ` · ${durationLabel}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="editor-import-btn"
                onClick={() => {
                  const clipId = onAdd(asset.id)
                  if (clipId) {
                    message.success('已添加到时间线')
                  } else {
                    message.warning('无法在该位置添加音频')
                  }
                }}
              >
                {addLabel}
              </button>
              <button
                type="button"
                className="editor-import-btn"
                disabled={usedOnTimeline}
                onClick={() => onRemove(asset.id)}
              >
                删除
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default AudioAssetLibrary
