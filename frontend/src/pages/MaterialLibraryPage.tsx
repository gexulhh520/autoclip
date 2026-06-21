import React, { useCallback, useEffect, useState } from 'react'
import { message, Modal } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import libraryApi, { type LibraryAsset } from '../services/libraryApi'
import './DesktopHomePage.css'
import './MaterialLibraryPage.css'

const MaterialLibraryPage: React.FC = () => {
  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [loading, setLoading] = useState(true)

  const loadAssets = useCallback(async () => {
    setLoading(true)
    try {
      const items = await libraryApi.listAssets()
      setAssets(items)
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '加载素材库失败')
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  const handleDelete = (asset: LibraryAsset) => {
    Modal.confirm({
      title: '从素材库移除？',
      content: '仅删除素材库中的副本，不影响已删除草稿的历史记录。',
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await libraryApi.deleteAsset(asset.id)
          setAssets((prev) => prev.filter((item) => item.id !== asset.id))
          message.success('已移除')
        } catch (error: unknown) {
          message.error(error instanceof Error ? error.message : '移除失败')
        }
      },
    })
  }

  return (
    <div className="desktop-page">
      <header className="desktop-page__header">
        <div>
          <h1 className="desktop-page__title">素材库</h1>
          <p className="desktop-page__subtitle">
            从剪辑草稿收藏的 AI 片段，可在任意新草稿中复用（后续支持拖入时间线）。
          </p>
        </div>
      </header>

      {loading ? (
        <div className="desktop-empty">加载中…</div>
      ) : assets.length === 0 ? (
        <div className="desktop-empty">
          暂无收藏。在剪辑编辑器「本草稿 AI 素材」上点击 ★ 即可收藏到这里。
        </div>
      ) : (
        <div className="material-library-grid">
          {assets.map((asset) => (
            <div key={asset.id} className="material-library-card">
              <video
                className="material-library-card__video"
                src={libraryApi.getVideoUrl(asset.id)}
                controls
                playsInline
                preload="metadata"
              />
              <div className="material-library-card__meta">
                <div className="material-library-card__title">{asset.title || asset.id}</div>
                {asset.promoted_at ? (
                  <div className="material-library-card__sub">
                    收藏于 {new Date(asset.promoted_at).toLocaleString()}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="material-library-card__delete"
                title="从素材库移除"
                onClick={() => handleDelete(asset)}
              >
                <DeleteOutlined />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MaterialLibraryPage
