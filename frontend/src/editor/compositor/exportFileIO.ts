/** 将 mediabunny 导出的 MP4 写入磁盘（Tauri）或触发浏览器下载 */
export async function writeExportVideoFile(path: string, data: ArrayBuffer): Promise<void> {
  const bytes = new Uint8Array(data)

  if (
    typeof window !== 'undefined' &&
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  ) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('write_binary_file', { path, data: bytes })
    return
  }

  const blob = new Blob([data], { type: 'video/mp4' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = path.split(/[/\\]/).pop() ?? 'export.mp4'
  anchor.click()
  URL.revokeObjectURL(url)
}
