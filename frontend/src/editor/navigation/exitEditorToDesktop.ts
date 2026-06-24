import type { NavigateFunction } from 'react-router-dom'
import { isTauriApp } from '../../utils/desktopMode'

/** 离开编辑器时最多等待保存的时间，避免桌面端 API 卡住导致无法返回 */
const EXIT_SAVE_BUDGET_MS = 1500

/**
 * 返回桌面首页。不无限等待保存：超时后仍跳转，卸载时 EditSessionPage 会继续 flush。
 */
export function exitEditorToDesktop(
  navigate: NavigateFunction,
  flushSave?: (projectId: string) => Promise<void>,
  projectId?: string
): void {
  let done = false
  const goHome = () => {
    if (done) return
    done = true
    navigate('/', { replace: true })
    if (isTauriApp()) {
      window.requestAnimationFrame(() => {
        const hash = window.location.hash
        if (
          hash.includes('/editor') ||
          (hash.includes('/project/') && hash.includes('/edit/'))
        ) {
          window.location.replace('#/')
        }
      })
    }
  }

  if (!flushSave || !projectId) {
    goHome()
    return
  }

  const timer = window.setTimeout(goHome, EXIT_SAVE_BUDGET_MS)
  void flushSave(projectId).finally(() => {
    window.clearTimeout(timer)
    goHome()
  })
}
