import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import libraryApi, { type MaterialLibraryTab } from '../services/libraryApi'
import MaterialAssetsTab from '../components/materialLibrary/MaterialAssetsTab'
import MaterialSearchTab from '../components/materialLibrary/MaterialSearchTab'
import MaterialDownloadsTab from '../components/materialLibrary/MaterialDownloadsTab'
import './DesktopHomePage.css'
import './MaterialLibraryPage.css'

const TAB_ITEMS: Array<{ key: MaterialLibraryTab; label: string }> = [
  { key: 'assets', label: '我的素材' },
  { key: 'search', label: '搜索' },
  { key: 'downloads', label: '下载中' },
]

const parseTab = (value: string | null): MaterialLibraryTab => {
  if (value === 'search' || value === 'downloads' || value === 'assets') return value
  return 'assets'
}

const MaterialLibraryPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = parseTab(searchParams.get('tab'))
  const [downloadRefreshNonce, setDownloadRefreshNonce] = useState(0)
  const [activeDownloadCount, setActiveDownloadCount] = useState(0)

  const refreshActiveCount = useCallback(async () => {
    try {
      const response = await libraryApi.listDownloads()
      setActiveDownloadCount(response.active_count)
    } catch {
      setActiveDownloadCount(0)
    }
  }, [])

  useEffect(() => {
    void refreshActiveCount()
  }, [refreshActiveCount, downloadRefreshNonce])

  useEffect(() => {
    if (activeTab !== 'downloads') return undefined
    const timer = window.setInterval(() => {
      void refreshActiveCount()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [activeTab, refreshActiveCount])

  const setActiveTab = (tab: MaterialLibraryTab) => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'assets') next.delete('tab')
    else next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  const handleDownloadStarted = useCallback(() => {
    setDownloadRefreshNonce((value) => value + 1)
    setActiveTab('downloads')
  }, [searchParams, setSearchParams])

  const tabContent = useMemo(() => {
    if (activeTab === 'search') {
      return <MaterialSearchTab onDownloadStarted={handleDownloadStarted} />
    }
    if (activeTab === 'downloads') {
      return <MaterialDownloadsTab refreshNonce={downloadRefreshNonce} />
    }
    return <MaterialAssetsTab />
  }, [activeTab, downloadRefreshNonce, handleDownloadStarted])

  return (
    <div className="desktop-page">
      <header className="desktop-page__header">
        <div>
          <h1 className="desktop-page__title">素材库</h1>
          <p className="desktop-page__subtitle">
            搜索并下载网络素材，或管理从剪辑草稿收藏的 AI 片段。
          </p>
        </div>
      </header>

      <div className="material-library-tabs" role="tablist" aria-label="素材库分区">
        {TAB_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={activeTab === item.key}
            className={`material-library-tabs__item ${activeTab === item.key ? 'is-active' : ''}`}
            onClick={() => setActiveTab(item.key)}
          >
            {item.label}
            {item.key === 'downloads' && activeDownloadCount > 0
              ? ` · ${activeDownloadCount}`
              : ''}
          </button>
        ))}
      </div>

      {tabContent}
    </div>
  )
}

export default MaterialLibraryPage
