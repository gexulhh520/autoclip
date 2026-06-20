import type { AgentToolResult } from '../../types/editorAgent'
import { serializeToolResultForChat } from './compactToolResultForChat'

/** 压缩 tool 结果后再写入 LLM 对话（§12.7 + P0 结构化压缩） */
export function sanitizeToolResultForChat(toolName: string, result: AgentToolResult): string {
  return serializeToolResultForChat(toolName, result)
}
