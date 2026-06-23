export const errorHandler = {
  handleError(error: unknown, context = 'App') {
    console.error(`[${context}]`, error)
  },
}

/** 从 Axios / fetch 等错误中提取用户可读文案（优先 FastAPI detail） */
export function getErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (typeof error === 'string' && error.trim()) return error.trim()

  const axiosLike = error as {
    message?: string
    response?: { data?: { detail?: unknown; message?: string } }
  }

  const detail = axiosLike.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg?: unknown }).msg ?? '')
        }
        return ''
      })
      .filter(Boolean)
    if (parts.length > 0) return parts.join('；')
  }

  const bodyMessage = axiosLike.response?.data?.message
  if (typeof bodyMessage === 'string' && bodyMessage.trim()) return bodyMessage.trim()

  if (error instanceof Error && error.message.trim()) {
    if (error.message.includes('Network Error')) return '网络连接失败，请检查网络后重试'
    return error.message
  }

  return fallback
}
