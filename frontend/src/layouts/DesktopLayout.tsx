import React from 'react'
import { Outlet } from 'react-router-dom'
import DesktopSidebar from '../components/desktop/DesktopSidebar'
import './DesktopLayout.css'

const DesktopLayout: React.FC = () => {
  return (
    <div className="desktop-shell">
      <DesktopSidebar />
      <main className="desktop-main">
        <Outlet />
      </main>
    </div>
  )
}

export default DesktopLayout
