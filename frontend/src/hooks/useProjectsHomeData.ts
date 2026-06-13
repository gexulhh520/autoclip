import { useEffect } from 'react'
import { message } from 'antd'
import { projectApi } from '../services/api'
import { useProjectStore } from '../store/useProjectStore'
import { useProjectPolling } from '../hooks/useProjectPolling'
import { useSimpleProgressStore } from '../stores/useSimpleProgressStore'

export function useProjectsHomeData() {
  const { projects, setProjects, loading, setLoading } = useProjectStore()

  useProjectPolling({
    onProjectsUpdate: (updatedProjects) => {
      setProjects(updatedProjects || [])
    },
    enabled: true,
    interval: 30000,
  })

  useEffect(() => {
    const hasActive = projects.some((p) => p.status === 'processing' || p.status === 'pending')
    if (!hasActive) {
      try {
        const { stopPolling, clearAllProgress } = useSimpleProgressStore.getState()
        stopPolling()
        clearAllProgress()
      } catch {
        // ignore
      }
    }
  }, [projects])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadProjects()
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  const loadProjects = async () => {
    setLoading(true)
    try {
      const items = await projectApi.getProjects()
      setProjects(Array.isArray(items) ? items : [])
    } catch (error) {
      message.error('加载项目失败')
      console.error('Load projects error:', error)
      setProjects([])
    } finally {
      setLoading(false)
    }
  }

  return { projects, loading, loadProjects }
}
