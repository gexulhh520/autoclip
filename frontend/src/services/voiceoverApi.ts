import api from './api'
import type { EditSession } from '../types/editSession'
import type {
  VoiceoverApplyBrollRequest,
  VoiceoverExecuteRequest,
  VoiceoverExecuteResponse,
  VoiceoverGenerateRequest,
  VoiceoverGenerateResponse,
  VoiceoverPlan,
  VoiceoverPlanResponse,
  VoiceoverSearchMaterialsRequest,
  VoiceoverSelectMaterialRequest,
  VoiceoverTranslateSearchQueriesRequest,
  VoiceoverUpdateSegmentSearchQueriesRequest,
} from '../types/voiceoverPlan'

const VOICEOVER_TIMEOUT_MS = 300_000

function voiceoverBase(projectId: string, sessionId: string): string {
  return `/projects/${projectId}/edit-sessions/${sessionId}/voiceover`
}

export const voiceoverApi = {
  getPlan: async (projectId: string, sessionId: string): Promise<VoiceoverPlanResponse> => {
    return (await api.get(`${voiceoverBase(projectId, sessionId)}/plan`)) as VoiceoverPlanResponse
  },

  generate: async (
    projectId: string,
    sessionId: string,
    payload: VoiceoverGenerateRequest
  ): Promise<VoiceoverGenerateResponse> => {
    return (await api.post(`${voiceoverBase(projectId, sessionId)}/generate`, payload, {
      timeout: VOICEOVER_TIMEOUT_MS,
    })) as VoiceoverGenerateResponse
  },

  updatePlan: async (
    projectId: string,
    sessionId: string,
    plan: VoiceoverPlan
  ): Promise<VoiceoverPlanResponse> => {
    return (await api.put(`${voiceoverBase(projectId, sessionId)}/plan`, { plan })) as VoiceoverPlanResponse
  },

  confirm: async (projectId: string, sessionId: string): Promise<VoiceoverPlanResponse> => {
    return (await api.post(`${voiceoverBase(projectId, sessionId)}/confirm`, {})) as VoiceoverPlanResponse
  },

  resetDraft: async (projectId: string, sessionId: string): Promise<VoiceoverPlanResponse> => {
    return (await api.post(
      `${voiceoverBase(projectId, sessionId)}/reset-draft`,
      {}
    )) as VoiceoverPlanResponse
  },

  deletePlan: async (projectId: string, sessionId: string): Promise<VoiceoverPlanResponse> => {
    return (await api.delete(`${voiceoverBase(projectId, sessionId)}/plan`)) as VoiceoverPlanResponse
  },

  regenerateSegment: async (
    projectId: string,
    sessionId: string,
    segmentId: string,
    instruction?: string
  ): Promise<VoiceoverPlanResponse> => {
    return (await api.post(
      `${voiceoverBase(projectId, sessionId)}/regenerate-segment`,
      { segment_id: segmentId, instruction: instruction ?? null },
      { timeout: VOICEOVER_TIMEOUT_MS }
    )) as VoiceoverPlanResponse
  },

  addSegment: async (
    projectId: string,
    sessionId: string,
    afterSegmentId?: string
  ): Promise<VoiceoverPlanResponse> => {
    const query = afterSegmentId ? `?after_segment_id=${encodeURIComponent(afterSegmentId)}` : ''
    return (await api.post(
      `${voiceoverBase(projectId, sessionId)}/segments${query}`,
      {}
    )) as VoiceoverPlanResponse
  },

  removeSegment: async (
    projectId: string,
    sessionId: string,
    segmentId: string
  ): Promise<VoiceoverPlanResponse> => {
    return (await api.delete(
      `${voiceoverBase(projectId, sessionId)}/segments/${encodeURIComponent(segmentId)}`
    )) as VoiceoverPlanResponse
  },

  execute: async (
    projectId: string,
    sessionId: string,
    payload: VoiceoverExecuteRequest
  ): Promise<VoiceoverExecuteResponse> => {
    return (await api.post(`${voiceoverBase(projectId, sessionId)}/execute`, payload, {
      timeout: VOICEOVER_TIMEOUT_MS,
    })) as VoiceoverExecuteResponse
  },

  executeSegment: async (
    projectId: string,
    sessionId: string,
    segmentId: string,
    payload: VoiceoverExecuteRequest = {}
  ): Promise<VoiceoverExecuteResponse> => {
    return (await api.post(
      `${voiceoverBase(projectId, sessionId)}/execute-segment/${encodeURIComponent(segmentId)}`,
      payload,
      { timeout: VOICEOVER_TIMEOUT_MS }
    )) as VoiceoverExecuteResponse
  },

  searchSegmentMaterials: async (
    projectId: string,
    sessionId: string,
    segmentId: string,
    payload: VoiceoverSearchMaterialsRequest = {}
  ): Promise<VoiceoverExecuteResponse> => {
    return (await api.post(
      `${voiceoverBase(projectId, sessionId)}/segments/${encodeURIComponent(segmentId)}/search-materials`,
      payload,
      { timeout: VOICEOVER_TIMEOUT_MS }
    )) as VoiceoverExecuteResponse
  },

  updateSegmentSearchQueries: async (
    projectId: string,
    sessionId: string,
    segmentId: string,
    payload: VoiceoverUpdateSegmentSearchQueriesRequest
  ): Promise<VoiceoverPlanResponse> => {
    return (await api.patch(
      `${voiceoverBase(projectId, sessionId)}/segments/${encodeURIComponent(segmentId)}/search-queries`,
      payload
    )) as VoiceoverPlanResponse
  },

  translateSegmentSearchQueries: async (
    projectId: string,
    sessionId: string,
    segmentId: string,
    payload: VoiceoverTranslateSearchQueriesRequest
  ): Promise<VoiceoverPlanResponse> => {
    return (await api.post(
      `${voiceoverBase(projectId, sessionId)}/segments/${encodeURIComponent(segmentId)}/translate-search-queries`,
      payload,
      { timeout: VOICEOVER_TIMEOUT_MS }
    )) as VoiceoverPlanResponse
  },

  selectSegmentMaterial: async (
    projectId: string,
    sessionId: string,
    segmentId: string,
    payload: VoiceoverSelectMaterialRequest
  ): Promise<VoiceoverExecuteResponse> => {
    return (await api.post(
      `${voiceoverBase(projectId, sessionId)}/segments/${encodeURIComponent(segmentId)}/select-material`,
      payload
    )) as VoiceoverExecuteResponse
  },

  applySegmentBroll: async (
    projectId: string,
    sessionId: string,
    segmentId: string,
    payload: VoiceoverApplyBrollRequest = {}
  ): Promise<VoiceoverExecuteResponse> => {
    return (await api.post(
      `${voiceoverBase(projectId, sessionId)}/segments/${encodeURIComponent(segmentId)}/apply-broll`,
      payload,
      { timeout: VOICEOVER_TIMEOUT_MS }
    )) as VoiceoverExecuteResponse
  },

  applyResponse: (response: VoiceoverPlanResponse): EditSession => response.session,
}
