import React, { useRef, useState } from 'react'
import { message } from 'antd'
import { LinkOutlined, PlusOutlined } from '@ant-design/icons'
import { filterAudioAssetsByCategory } from '../../../../../editor/audioTracks'
import { useEditSessionStore } from '../../../../../stores/useEditSessionStore'
import OpenCutPanelView from '../../../opencut/OpenCutPanelView'
import EditorImportBgmUrlModal from '../../../EditorImportBgmUrlModal'
import AudioAssetLibrary from './AudioAssetLibrary'

interface BgmAssetsViewProps {
  projectId: string
}

const BgmAssetsView: React.FC<BgmAssetsViewProps> = ({ projectId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [bgmUrlModalOpen, setBgmUrlModalOpen] = useState(false)

  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const uploadBgm = useEditSessionStore((state) => state.uploadBgm)
  const importBgmFromUrl = useEditSessionStore((state) => state.importBgmFromUrl)
  const updateAudioSettings = useEditSessionStore((state) => state.updateAudioSettings)
  const removeAudioAsset = useEditSessionStore((state) => state.removeAudioAsset)
  const addAudioClipToTimeline = useEditSessionStore((state) => state.addAudioClipToTimeline)
  const activeAudioTrackId = useEditSessionStore((state) => state.activeAudioTrackId)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)

  if (!session) return null

  const audioSettings = session.audio_settings
  const bgmAssets = filterAudioAssetsByCategory(session, 'bgm')

  return (
    <OpenCutPanelView
      title="BGM"
      actions={
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/mp4,video/quicktime,.aiff,.aif"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              try {
                await uploadBgm(projectId, file)
                message.success('已导入 BGM，拖到时间线或点击「添加」')
              } catch {
                message.error('BGM 导入失败')
              }
            }}
          />
          <button
            type="button"
            className="editor-import-btn"
            disabled={saving}
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusOutlined /> 导入 BGM
          </button>
          <button
            type="button"
            className="editor-import-btn"
            disabled={saving}
            onClick={() => setBgmUrlModalOpen(true)}
          >
            <LinkOutlined /> 从链接导入
          </button>
        </>
      }
    >
      <EditorImportBgmUrlModal
        open={bgmUrlModalOpen}
        saving={saving}
        onClose={() => setBgmUrlModalOpen(false)}
        onSubmit={async (url, platform) => {
          try {
            await importBgmFromUrl(projectId, url, platform)
            setBgmUrlModalOpen(false)
            message.success('已从链接导入 BGM')
          } catch {
            message.error('链接导入失败，请检查链接是否有效')
          }
        }}
      />

      <div className="editor-inspector-section">
        <div className="editor-inspector-label">BGM 混音</div>
        <label className="editor-modal__field">
          <span>默认音量 ({Math.round((audioSettings.bgm_volume ?? 0.28) * 100)}%)</span>
          <input
            className="editor-range"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={audioSettings.bgm_volume ?? 0.28}
            onChange={(event) =>
              updateAudioSettings({ bgm_volume: Number(event.target.value) })
            }
          />
        </label>
        <label className="editor-modal__check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={audioSettings.bgm_duck_enabled ?? true}
            onChange={(event) =>
              updateAudioSettings({ bgm_duck_enabled: event.target.checked })
            }
          />
          人声 Ducking（导出时压低 BGM）
        </label>
        <label className="editor-modal__check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={audioSettings.use_source_video}
            onChange={(event) =>
              updateAudioSettings({ use_source_video: event.target.checked })
            }
          />
          导出从原片重切
        </label>
      </div>

      <div className="editor-inspector-label" style={{ marginTop: 16 }}>
        BGM 库 ({bgmAssets.length})
      </div>
      <AudioAssetLibrary
        session={session}
        assets={bgmAssets}
        emptyHint="暂无 BGM。可上传本地文件，或从 B站 / 抖音等链接导入。"
        addLabel="添加到播放头"
        onAdd={(assetId) => {
          const clipId = addAudioClipToTimeline(assetId, {
            trackId: activeAudioTrackId ?? undefined,
            strictStart: true,
          })
          if (clipId) setInspectorTab('audio')
          return clipId
        }}
        onRemove={removeAudioAsset}
      />
    </OpenCutPanelView>
  )
}

export default BgmAssetsView
