import type { AudioClipElement, EditBlock, EditOverlayElement } from '../../types/editSession'

export type EditorClipboard =
  | { kind: 'video_block'; block: EditBlock }
  | { kind: 'text_overlay'; element: EditOverlayElement }
  | { kind: 'audio_clip'; clip: AudioClipElement }

export const cloneEditorClipboard = (item: EditorClipboard): EditorClipboard => {
  if (item.kind === 'video_block') {
    return { kind: 'video_block', block: JSON.parse(JSON.stringify(item.block)) as EditBlock }
  }
  if (item.kind === 'text_overlay') {
    return {
      kind: 'text_overlay',
      element: JSON.parse(JSON.stringify(item.element)) as EditOverlayElement,
    }
  }
  return { kind: 'audio_clip', clip: JSON.parse(JSON.stringify(item.clip)) as AudioClipElement }
}
