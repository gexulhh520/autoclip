import type { LayoutAnalysis } from '../../types/editorAgent'
import type { EditorSnapshot } from './buildEditorSnapshot'
import type { AgentToolCall } from '../../types/editorAgent'

/** 本地 fallback：从 LayoutAnalysis + 草稿文案生成写工具计划（F1 + A1 + C2 默认由 execute 层处理） */
export function buildApplyPlanFromLayout(
  snapshot: EditorSnapshot,
  layout: LayoutAnalysis
): AgentToolCall[] {
  const calls: AgentToolCall[] = []
  const duration = Math.max(snapshot.total_duration_sec, 3)
  const texts = snapshot.draft_texts

  layout.elements.forEach((element, index) => {
    const content = texts[index] ?? texts[texts.length - 1] ?? '文本'
    if (!content) return
    const t = element.transform
    calls.push({
      name: 'add_text_overlay',
      arguments: {
        start_sec: 0,
        duration_sec: duration,
        content,
        fontSize: element.fontSize ?? 6,
        fontFamily: element.fontFamily,
        color: element.color ?? '#ffffff',
        fontWeight: element.fontWeight ?? 'normal',
        textAlign: element.textAlign ?? 'left',
        lineHeight: element.lineHeight ?? 1.2,
        positionX: t.positionX,
        positionY: t.positionY,
        scaleX: t.scaleX,
        scaleY: t.scaleY,
        rotate: t.rotate,
        background_enabled: element.background?.enabled ?? false,
        background_color: element.background?.color,
        background_paddingX: element.background?.paddingX,
        background_paddingY: element.background?.paddingY,
        background_cornerRadius: element.background?.cornerRadius,
      },
    })
  })

  const framing = layout.video_framing
  if (framing) {
    for (const block of snapshot.blocks) {
      if (block.track_id !== 'default-video') continue
      calls.push({
        name: 'set_video_transform',
        arguments: {
          block_id: block.id,
          position_x: framing.suggested_position_x,
          position_y: framing.suggested_position_y,
          scale_x: framing.suggested_scale_x,
          scale_y: framing.suggested_scale_y,
        },
      })
    }
  }

  return calls
}
