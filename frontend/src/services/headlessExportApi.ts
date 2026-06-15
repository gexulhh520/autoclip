import api from './api'
import type {
  HeadlessExportCompleteRequest,
  HeadlessExportFailRequest,
  HeadlessExportJobItem,
  HeadlessExportPendingResponse,
  HeadlessExportProgressRequest,
} from '../types/editSession'

export const headlessExportApi = {
  listPending: async (limit = 20): Promise<HeadlessExportJobItem[]> => {
    const response = (await api.get('/editor/headless-export/pending', {
      params: { limit },
    })) as HeadlessExportPendingResponse
    return response.jobs
  },

  claim: async (
    projectId: string,
    sessionId: string,
    jobId: string
  ): Promise<HeadlessExportJobItem> => {
    return (await api.post(
      `/editor/headless-export/${projectId}/${sessionId}/${jobId}/claim`
    )) as HeadlessExportJobItem
  },

  reportProgress: async (
    projectId: string,
    sessionId: string,
    jobId: string,
    body: HeadlessExportProgressRequest
  ): Promise<void> => {
    await api.post(`/editor/headless-export/${projectId}/${sessionId}/${jobId}/progress`, body)
  },

  complete: async (
    projectId: string,
    sessionId: string,
    jobId: string,
    body: HeadlessExportCompleteRequest
  ): Promise<void> => {
    await api.post(`/editor/headless-export/${projectId}/${sessionId}/${jobId}/complete`, body)
  },

  fail: async (
    projectId: string,
    sessionId: string,
    jobId: string,
    body: HeadlessExportFailRequest
  ): Promise<void> => {
    await api.post(`/editor/headless-export/${projectId}/${sessionId}/${jobId}/fail`, body)
  },
}

export default headlessExportApi
