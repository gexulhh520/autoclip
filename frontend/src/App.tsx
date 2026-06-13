import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import DesktopLayout from './layouts/DesktopLayout'
import DesktopHomePage from './pages/DesktopHomePage'
import AiSlicePage from './pages/AiSlicePage'
import EditorHubPage from './pages/EditorHubPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import SettingsPage from './pages/SettingsPage'
import TemplatesPage from './pages/TemplatesPage'
import EditSessionPage from './pages/EditSessionPage'
import { trackPageview } from './analytics/posthog'

function usePageviewTracking() {
  const location = useLocation()
  useEffect(() => {
    trackPageview(location.pathname + location.search)
  }, [location.pathname, location.search])
}

function App() {
  console.log('🎬 App组件已加载')
  usePageviewTracking()

  return (
    <Routes>
      <Route path="/editor/draft/:sessionId" element={<EditSessionPage />} />
      <Route path="/project/:id/edit/:sessionId" element={<EditSessionPage />} />
      <Route element={<DesktopLayout />}>
        <Route path="/" element={<DesktopHomePage />} />
        <Route path="/editor" element={<EditorHubPage />} />
        <Route path="/ai-slice" element={<AiSlicePage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/project/:id" element={<ProjectDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

export default App
