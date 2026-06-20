import type { AgentToolResult } from '../../types/editorAgent'

/** §12.7：capture_preview_frame 大图不写入持久对话，仅当前 tool 回传 */
export function sanitizeToolResultForChat(toolName: string, result: AgentToolResult): string {
  if (toolName !== 'capture_preview_frame' || !result.data || typeof result.data !== 'object') {
    return JSON.stringify(result)
  }
  const data = result.data as Record<string, unknown>
  const width = data.width
  const height = data.height
  const placeholder =
    typeof width === 'number' && typeof height === 'number'
      ? `[jpeg ${width}x${height} omitted]`
      : '[jpeg omitted]'
  return JSON.stringify({
    ...result,
    data: {
      ...data,
      image_base64: placeholder,
    },
  })
}
