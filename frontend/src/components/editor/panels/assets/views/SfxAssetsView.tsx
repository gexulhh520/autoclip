import React, { useRef } from 'react'
import { message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { filterAudioAssetsByCategory } from '../../../../../editor/audioTracks'
import { useEditSessionStore } from '../../../../../stores/useEditSessionStore'
import OpenCutPanelView from '../../../opencut/OpenCutPanelView'
import AudioAssetLibrary from './AudioAssetLibrary'

interface SfxAssetsViewProps {
  projectId: string
}

const SfxAssetsView: React.FC<SfxAssetsViewProps> = ({ projectId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const uploadSfx = useEditSessionStore((state) => state.uploadSfx)
  const removeAudioAsset = useEditSessionStore((state) => state.removeAudioAsset)
  const addAudioClipToTimeline = useEditSessionStore((state) => state.addAudioClipToTimeline)
  const activeAudioTrackId = useEditSessionStore((state) => state.activeAudioTrackId)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)

  if (!session) return null

  const sfxAssets = filterAudioAssetsByCategory(session, 'sfx')

  return (
    <OpenCutPanelView
      title="音效"
      actions={
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              try {
                await uploadSfx(projectId, file)
                message.success('已导入音效，拖到时间线或点击「添加」')
              } catch {
                message.error('音效导入失败')
              }
            }}
          />
          <button
            type="button"
            className="editor-import-btn"
            disabled={saving}
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusOutlined /> 导入音效
          </button>
        </>
      }
    >
      <p className="editor-inspector-muted" style={{ marginTop: 0 }}>
        短音效、提示音、环境声等。导入后拖到下方音频轨，或在播放头位置点击「添加」。
      </p>
      <div className="editor-inspector-label" style={{ marginTop: 16 }}>
        音效库 ({sfxAssets.length})
      </div>
      <AudioAssetLibrary
        session={session}
        assets={sfxAssets}
        emptyHint="暂无音效。点击「导入音效」上传 mp3 / wav 等文件。"
        addLabel="添加到播放头"
        onAdd={(assetId) => {
          addAudioClipToTimeline(assetId, { trackId: activeAudioTrackId ?? undefined })
          setInspectorTab('audio')
        }}
        onRemove={removeAudioAsset}
      />
    </OpenCutPanelView>
  )
}

export default SfxAssetsView
