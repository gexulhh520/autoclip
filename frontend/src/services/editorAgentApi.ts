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
      payload
    )) as AnalyzeVideoContentResponse
  },

  findBlockMoments: async (
    projectId: string,
    sessionId: string,
    payload: FindBlockMomentsRequest
  ): Promise<FindBlockMomentsResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/agent/find-block-moments`,
      payload
    )) as FindBlockMomentsResponse
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
