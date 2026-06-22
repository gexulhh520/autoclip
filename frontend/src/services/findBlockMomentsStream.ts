import { apiConfigManager } from '../utils/apiConfig'
import type {
  FindBlockMomentsRequest,
  FindBlockMomentsResponse,
  FindBlockMomentsStreamEvent,
} from '../types/editorAgent'

const AGENT_LONG_TIMEOUT_MS = 900_000

export interface FindBlockMomentsStreamCallbacks {
  onEvent: (event: FindBlockMomentsStreamEvent) => void
  signal?: AbortSignal
}

/** 滑窗 clip 分类渐进检索（NDJSON 流） */
export async function findBlockMomentsStream(
  projectId: string,
  sessionId: string,
  payload: FindBlockMomentsRequest,
  callbacks: FindBlockMomentsStreamCallbacks
): Promise<FindBlockMomentsResponse> {
  const baseUrl = apiConfigManager.getBaseUrl().replace(/\/$/, '')
  const url = `${baseUrl}/projects/${projectId}/edit-sessions/${sessionId}/agent/find-block-moments/stream`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), AGENT_LONG_TIMEOUT_MS)
  const signal = callbacks.signal
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('流式响应不可用')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let finalResponse: FindBlockMomentsResponse | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const event = JSON.parse(trimmed) as FindBlockMomentsStreamEvent
      callbacks.onEvent(event)
      if (event.type === 'done') {
        finalResponse = {
          block_id: event.block_id ?? payload.block_id,
          search_criteria: event.search_criteria ?? payload.search_criteria,
          transcript_source: event.transcript_source ?? 'none',
          transcript_segment_count: event.transcript_segment_count ?? 0,
          visual_frame_count: event.visual_frame_count ?? 0,
          matches: event.matches ?? [],
          note: event.note ?? '',
        }
      }
      if (event.type === 'error') {
        throw new Error(event.message || '片段检索失败')
      }
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer.trim()) as FindBlockMomentsStreamEvent
    callbacks.onEvent(event)
    if (event.type === 'done') {
      finalResponse = {
        block_id: event.block_id ?? payload.block_id,
        search_criteria: event.search_criteria ?? payload.search_criteria,
        transcript_source: event.transcript_source ?? 'none',
        transcript_segment_count: event.transcript_segment_count ?? 0,
        visual_frame_count: event.visual_frame_count ?? 0,
        matches: event.matches ?? [],
        note: event.note ?? '',
      }
    }
  }

  if (!finalResponse) {
    throw new Error('检索流未返回最终结果')
  }
  return finalResponse
}
