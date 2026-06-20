import api from './api'
import type {
  AnalyzeLayoutRequest,
  AnalyzeLayoutResponse,
  AgentChatRequest,
  AgentChatResponse,
} from '../types/editorAgent'

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

  chat: async (
    projectId: string,
    sessionId: string,
    payload: AgentChatRequest
  ): Promise<AgentChatResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/agent/chat`,
      payload
    )) as AgentChatResponse
  },
}
