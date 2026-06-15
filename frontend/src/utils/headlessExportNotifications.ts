import { message } from 'antd'

import { isTauriApp } from './desktopMode'

export async function ensureDesktopNotificationPermission(): Promise<boolean> {
  if (!isTauriApp() || typeof Notification === 'undefined') {
    return false
  }
  if (Notification.permission === 'granted') {
    return true
  }
  if (Notification.permission === 'denied') {
    return false
  }
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function sendSystemNotification(title: string, body: string, tag: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return
  }
  try {
    new Notification(title, { body, tag })
  } catch {
    // WebView 可能不支持系统通知，忽略
  }
}

export async function notifyHeadlessExportComplete(
  filename: string,
  localOutputPath?: string | null
): Promise<void> {
  message.success(`后台导出完成：${filename}`, 4)
  if (!(await ensureDesktopNotificationPermission())) {
    return
  }
  sendSystemNotification(
    'AutoClip 后台导出完成',
    localOutputPath ? `已保存至 ${localOutputPath}` : filename,
    `headless-export-complete-${filename}`
  )
}

export async function notifyHeadlessExportFailed(
  filename: string,
  errorMessage?: string | null
): Promise<void> {
  message.error(`后台导出失败：${filename}`, 5)
  if (!(await ensureDesktopNotificationPermission())) {
    return
  }
  sendSystemNotification(
    'AutoClip 后台导出失败',
    errorMessage?.trim() || filename,
    `headless-export-failed-${filename}`
  )
}
