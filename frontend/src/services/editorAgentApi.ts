import api from './api'
import type {
  AnalyzeLayoutRequest,
  AnalyzeLayoutResponse,
  AnalyzeSubtitleFrameRequest,
  AnalyzeSubtitleFrameResponse,
  AnalyzeVideoContentRequest,
  AnalyzeVideoContentResponse,
  FindBlockMomentsRequest,
  FindBlockMomentsResponse,
  AgentChatRequest,
  AgentChatResponse,
  ClassifyAgentIntentRequest,
  ClassifyAgentIntentResponse,
} from '../types/editorAgent'

/** Agent 检索/分析/对话可能含 Whisper、多帧视觉 LLM，需长于默认 5 分钟 */
const AGENT_LONG_TIMEOUT_MS = 900_000

export const editorAgentApi = {
  analyzeLayout: async (
    projectId: string,
    sessionId: string,
    payload: AnalyzeLayoutRequest
  ): Promise<AnalyzeLayoutResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/agent/analyze-layout`,
      payload
    )) as AnalyzeLayoutResponse
  },

  analyzeSubtitleFrame: async (
    projectId: string,
    sessionId: string,
    payload: AnalyzeSubtitleFrameRequest
  ): Promise<AnalyzeSubtitleFrameResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/agent/analyze-subtitle-frame`,
      payload
    )) as AnalyzeSubtitleFrameResponse
  },

  analyzeVideoContent: async (
    projectId: string,
    sessionId: string,
    payload: AnalyzeVideoContentRequest
  ): Promise<AnalyzeVideoContentResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/agent/analyze-video-content`,
      payload,
      { timeout: AGENT_LONG_TIMEOUT_MS }
    )) as AnalyzeVideoContentResponse
  },

  findBlockMoments: async (
    projectId: string,
    sessionId: string,
    payload: FindBlockMomentsRequest
  ): Promise<FindBlockMomentsResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/agent/find-block-moments`,
      payload,
      { timeout: AGENT_LONG_TIMEOUT_MS }
    )) as FindBlockMomentsResponse
  },

  classifyIntent: async (
    projectId: string,
    sessionId: string,
    payload: ClassifyAgentIntentRequest
  ): Promise<ClassifyAgentIntentResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/agent/classify-intent`,
      payload,
      { timeout: 60_000 }
    )) as ClassifyAgentIntentResponse
  },

  chat: async (
    projectId: string,
    sessionId: string,
    payload: AgentChatRequest
  ): Promise<AgentChatResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/agent/chat`,
      payload,
      { timeout: AGENT_LONG_TIMEOUT_MS }
    )) as AgentChatResponse
  },
}
