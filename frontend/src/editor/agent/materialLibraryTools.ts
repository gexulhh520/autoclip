import libraryApi, { type MaterialSearchResult } from '../../services/libraryApi'

export interface SearchMaterialsArgs {
  platform?: unknown
  query?: unknown
  limit?: unknown
}

export async function searchMaterials(args: SearchMaterialsArgs): Promise<{
  platform: string
  query: string
  items: MaterialSearchResult[]
}> {
  const platform = String(args.platform ?? 'youtube').trim().toLowerCase()
  const query = String(args.query ?? '').trim()
  if (!query) {
    throw new Error('query 不能为空')
  }
  let limit = 10
  if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
    limit = Math.max(1, Math.min(20, Math.floor(args.limit)))
  }
  const items = await libraryApi.search({ platform, query, limit })
  return { platform, query, items }
}

export async function waitForDownloadTask(
  taskId: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 180_000
  const intervalMs = options?.intervalMs ?? 2000
  const started = Date.now()

  while Date.now() - started < timeoutMs) {
    const response = await libraryApi.listDownloads()
    const task = response.items.find((item) => item.id === taskId)
    if (!task) {
      throw new Error(`下载任务不存在: ${taskId}`)
    }
    if (task.status === 'completed' && task.asset_id) {
      return task.asset_id
    }
    if (task.status === 'failed') {
      throw new Error(task.error_message || '素材下载失败')
    }
    if (task.status === 'cancelled') {
      throw new Error('素材下载已取消')
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
  }
  throw new Error('素材下载超时，请稍后在素材库「下载中」查看进度')
}

export async function resolveLibraryAssetIdFromUrl(url: string): Promise<string> {
  const trimmed = url.trim()
  if (!trimmed) {
    throw new Error('url 不能为空')
  }
  const tasks = await libraryApi.downloadFromUrl(trimmed)
  if (tasks.length === 0) {
    throw new Error('无法创建下载任务（可能已在库中或队列中）')
  }
  const task = tasks[0]
  if (task.asset_id) {
    return task.asset_id
  }
  return waitForDownloadTask(task.id)
}
