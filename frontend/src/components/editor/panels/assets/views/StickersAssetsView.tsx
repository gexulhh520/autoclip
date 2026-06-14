import React, { useMemo, useState } from 'react'
import OpenCutPanelView from '../../../opencut/OpenCutPanelView'
import { resolveCanvasDimensions } from '../../../../../editor/scene/canvas'
import { useEditSessionStore } from '../../../../../stores/useEditSessionStore'
import AssetPresetCard from '../AssetPresetCard'
import { buildStickerParams, STICKER_PRESETS } from '../stickerPresets'

const StickersAssetsView: React.FC = () => {
  const session = useEditSessionStore((state) => state.session)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const addOverlayElement = useEditSessionStore((state) => state.addOverlayElement)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return STICKER_PRESETS
    return STICKER_PRESETS.filter(
      (item) => item.label.includes(q) || item.emoji.includes(q)
    )
  }, [query])

  if (!session) return null
  const dims = resolveCanvasDimensions(session.export_settings)

  const addSticker = (emoji: string) => {
    addOverlayElement({
      start_sec: sequencePlayheadSec,
      duration_sec: 2.5,
      params: buildStickerParams(emoji, dims.width, dims.height),
    })
    setInspectorTab('text')
  }

  return (
    <OpenCutPanelView title="贴纸">
      <input
        className="editor-select editor-asset-search"
        type="search"
        placeholder="搜索贴纸…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="editor-asset-preset-grid" style={{ marginTop: 10 }}>
        {filtered.map((sticker) => (
          <AssetPresetCard
            key={sticker.id}
            name={sticker.label}
            onAdd={() => addSticker(sticker.emoji)}
            preview={
              <span className="editor-asset-preset-card__emoji-preview">{sticker.emoji}</span>
            }
          />
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="editor-inspector-muted" style={{ marginTop: 12 }}>无匹配贴纸</p>
      ) : null}
    </OpenCutPanelView>
  )
}

export default StickersAssetsView
