/** 强制停止剪辑预览中可能挂在 DOM 上的音视频（离开页面 / 重置 session 时兜底） */
export function stopEditorPlayback(): void {
  for (const video of document.querySelectorAll('video.compositor-preview__decoder')) {
    video.pause()
    video.muted = true
  }

  for (const video of document.querySelectorAll('.editor-preview-video-layer video')) {
    video.pause()
    video.muted = true
  }

  for (const audio of document.querySelectorAll('audio[data-clip-id]')) {
    audio.pause()
    audio.volume = 0
  }
}
