import React, { useCallback, useEffect, useState } from 'react'
import { message } from 'antd'
import { FolderOpenOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import libraryApi, { type LibraryAsset } from '../../services/libraryApi'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import { formatVideoImportSuccessMessage } from '../../utils/videoImportMessage'

interface GlobalLibraryAssetsSectionProps {
  projectId: string
}

const GlobalLibraryAssetsSection: React.FC<GlobalLibraryAssetsSectionProps> = ({ projectId }) => {
  const navigate = useNavigate()
  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const loading = useEditSessionStore((state) => state.loading)
  const importLibraryAsset = useEditSessionStore((state) => state.importLibraryAsset)

  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [importingId, setImportingId] = useState<string | null>(null)

  const loadAssets = useCallback(async () => {
    setLoadingAssets(true)
    try {
      const response = await libraryApi.listAssets({ page: 1, page_size: 12 })
      setAssets(response.items)
    } catch {
      setAssets([])
    } finally {
      setLoadingAssets(false)
    }
  }, [])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  const handleImport = async (asset: LibraryAsset) => {
    if (!session) {
      message.error('剪辑工程尚未加载')
      return
    }
    setImportingId(asset.id)
    try {
      const result = await importLibraryAsset(projectId, asset.id)
      message.success(formatVideoImportSuccessMessage(result.title || asset.title, result.import_method))
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '导入素材失败')
    } finally {
      setImportingId(null)
    }
  }

  const openLibrary = () => {
    if (!session) {
      navigate('/library?tab=search')
      return
    }
    navigate(
      `/library?tab=assets&projectId=${encodeURIComponent(projectId)}&sessionId=${encodeURIComponent(session.id)}`
    )
  }

  return (
    <div className="editor-global-library">
      <div className="editor-inspector-label editor-global-library__header">
        <span>全局素材库</span>
        <button type="button" className="editor-global-library__link" onClick={openLibrary}>
          <FolderOpenOutlined /> 打开素材库
        </button>
      </div>
      {loadingAssets ? (
        <div className="editor-asset-empty">加载中…</div>
      ) : assets.length === 0 ? (
        <div className="editor-asset-empty">
          暂无素材。
          <button type="button" className="editor-global-library__inline-link" onClick={openLibrary}>
            去搜索下载
          </button>
        </div>
      ) : (
        <div className="editor-clip-list editor-global-library__list">
          {assets.map((asset) => (
            <div key={asset.id} className="editor-media-card">
              <div className="editor-media-card__preview">
                <video
                  className="editor-media-card__thumb"
                  src={libraryApi.getVideoUrl(asset.id)}
                  muted
                  playsInline
                  preload="metadata"
                  poster={
                    asset.thumbnail_path ? libraryApi.getThumbnailUrl(asset.id) : undefined
                  }
                />
                <div className="editor-media-card__title">{asset.title || asset.id}</div>
              </div>
              <div className="editor-media-card__actions">
                <button
                  type="button"
                  className="editor-media-card__add"
                  title="添加到时间线"
                  disabled={!session || saving || loading || importingId === asset.id}
                  onClick={() => void handleImport(asset)}
                >
                  <PlusOutlined />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default GlobalLibraryAssetsSection
