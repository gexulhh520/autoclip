import { isTauriApp } from './desktopMode'
import editApi from '../services/editApi'

const STORAGE_KEY = 'autoclip-editor-export-dir'

export function getSavedExportDirectory(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function saveExportDirectory(dir: string): void {
  localStorage.setItem(STORAGE_KEY, dir.trim())
}

export async function fetchDefaultExportDirectory(): Promise<string> {
  try {
    const result = await editApi.getDefaultExportDirectory()
    return result.path
  } catch {
    return ''
  }
}

export async function resolveInitialExportDirectory(): Promise<string> {
  const saved = getSavedExportDirectory()
  if (saved) return saved
  return fetchDefaultExportDirectory()
}

async function pickWithTauriDialog(current?: string | null): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: current?.trim() || undefined,
      title: '选择导出目录',
    })
    if (typeof selected === 'string' && selected.trim()) {
      return selected.trim()
    }
    return null
  } catch (error) {
    console.warn('plugin-dialog 选择目录失败，尝试 invoke:', error)
  }

  if (!isTauriApp()) return null

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const picked = await invoke<string | null>('pick_export_directory', {
      defaultPath: current ?? null,
    })
    if (typeof picked === 'string' && picked.trim()) {
      return picked.trim()
    }
  } catch (error) {
    console.error('invoke 选择目录失败:', error)
  }
  return null
}

/** 打开系统目录选择器；非桌面环境返回 null（请手动输入路径） */
export async function pickExportDirectory(current?: string | null): Promise<string | null> {
  if (isTauriApp()) {
    const picked = await pickWithTauriDialog(current)
    if (picked) {
      saveExportDirectory(picked)
      return picked
    }
    return null
  }
  return null
}

export async function normalizeExportDirectory(path: string): Promise<string | null> {
  const trimmed = path.trim()
  if (!trimmed) return null
  try {
    const result = await editApi.validateExportDirectory(trimmed)
    saveExportDirectory(result.path)
    return result.path
  } catch {
    return null
  }
}

export async function revealExportDirectory(dirPath: string): Promise<void> {
  const trimmed = dirPath.trim()
  if (!trimmed) return

  if (isTauriApp()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('reveal_export_directory', { path: trimmed })
      return
    } catch (error) {
      console.error('打开导出目录失败:', error)
    }
  }

  try {
    const { openExternalLink } = await import('./externalLinks')
    await openExternalLink(`file:///${trimmed.replace(/\\/g, '/')}`)
  } catch {
    // ignore
  }
}
