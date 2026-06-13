import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  HomeOutlined,
  AppstoreOutlined,
  SettingOutlined,
  BulbOutlined,
  MoonOutlined,
} from '@ant-design/icons'
import { useTheme } from '../../context/ThemeContext'

const NAV_ITEMS = [
  { key: 'home', path: '/', label: '首页', icon: <HomeOutlined /> },
  { key: 'ai-slice', path: '/ai-slice', label: 'AI 自动切片', icon: <AppstoreOutlined /> },
] as const

const DesktopSidebar: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    if (path === '/ai-slice') {
      return location.pathname === '/ai-slice' || location.pathname.startsWith('/project/')
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  return (
    <aside className="desktop-sidebar">
      <button type="button" className="desktop-sidebar__brand" onClick={() => navigate('/')}>
        <span className="desktop-sidebar__wordmark">
          Auto<em style={{ fontStyle: 'italic' }}>Clip</em>
        </span>
      </button>

      <nav className="desktop-sidebar__nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`desktop-nav-item ${isActive(item.path) ? 'is-active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            <span className="desktop-nav-item__icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="desktop-sidebar__footer">
        <button
          type="button"
          className="desktop-nav-item"
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
        >
          <span className="desktop-nav-item__icon">
            {theme === 'dark' ? <BulbOutlined /> : <MoonOutlined />}
          </span>
          <span>{theme === 'dark' ? '亮色模式' : '暗色模式'}</span>
        </button>
        <button
          type="button"
          className={`desktop-nav-item ${isActive('/settings') ? 'is-active' : ''}`}
          onClick={() => navigate('/settings')}
        >
          <span className="desktop-nav-item__icon">
            <SettingOutlined />
          </span>
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}

export default DesktopSidebar
