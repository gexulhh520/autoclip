import editApi from '../../services/editApi'
import headlessExportApi from '../../services/headlessExportApi'
import { useHeadlessExportWorkerStore } from '../../stores/useHeadlessExportWorkerStore'
import type { HeadlessExportJobItem } from '../../types/editSession'
import {
  normalizeExportDirectory,
  resolveInitialExportDirectory,
} from '../../utils/editorExportLocal'
import { isTauriRuntime } from './compositorClient'
import { buildCompositorRuntimeParams, runCompositorExportAndMux } from './runCompositorExport'

const POLL_INTERVAL_MS = 5000
const MAX_JOBS_PER_TICK = 1

let workerTimer: number | null = null
let processing = false

function patchJob(job: Partial<HeadlessExportJobItem> & Pick<HeadlessExportJobItem, 'job_id'>) {
  useHeadlessExportWorkerStore.getState().upsertJob({
    job_id: job.job_id,
    project_id: job.project_id ?? '',
    session_id: job.session_id ?? '',
    filename: job.filename ?? 'export',
    burn_subtitles: job.burn_subtitles ?? true,
    export_srt: job.export_srt ?? false,
    plan_path: job.plan_path ?? '',
    status: job.status ?? 'pending',
    progress: job.progress ?? 0,
    message: job.message ?? '',
    ...job,
  })
}

async function resolveOutputDir(job: HeadlessExportJobItem): Promise<string> {
  const raw = job.output_dir ?? (await resolveInitialExportDirectory())
  const normalized = raw ? await normalizeExportDirectory(raw) : null
  return normalized ?? raw ?? ''
}

export async function processHeadlessExportJob(job: HeadlessExportJobItem): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('Headless Compositor 导出仅支持桌面客户端')
  }

  patchJob({ ...job, status: 'running', progress: 1, message: 'OpenCut 导出处理中' })
  const claimed = await headlessExportApi.claim(job.project_id, job.session_id, job.job_id)
  patchJob(claimed)

  const session = await editApi.getSession(job.project_id, job.session_id)
  const outputDir = await resolveOutputDir(job)
  if (!outputDir.trim()) {
    throw new Error('未配置有效导出目录')
  }

  const useSourceVideo = job.use_source_video ?? session.audio_settings.use_source_video ?? false
  const runtime = buildCompositorRuntimeParams(job.project_id, session, useSourceVideo)

  const report = (percent: number, message: string) => {
    patchJob({
      ...job,
      status: 'running',
      progress: percent,
      message,
    })
    void headlessExportApi.reportProgress(job.project_id, job.session_id, job.job_id, {
      progress: percent,
      message,
    })
  }

  report(5, '加载剪辑工程')

  const muxResult = await runCompositorExportAndMux(runtime, {
    burnSubtitles: job.burn_subtitles,
    useSourceVideo,
    filename: job.filename,
    outputDir,
    exportSrt: job.export_srt,
    onProgress: report,
  })

  await headlessExportApi.complete(job.project_id, job.session_id, job.job_id, {
    output_path: muxResult.localOutputPath ?? muxResult.compositorVideoPath,
    download_url: muxResult.videoUrl ?? '',
    local_output_path: muxResult.localOutputPath ?? null,
    srt_path: muxResult.localSrtPath ?? null,
    srt_download_url: muxResult.srtUrl ?? null,
    local_srt_path: muxResult.localSrtPath ?? null,
  })

  patchJob({
    ...job,
    status: 'completed',
    progress: 100,
    message: 'Headless 导出完成',
    local_output_path: muxResult.localOutputPath ?? null,
    local_srt_path: muxResult.localSrtPath ?? null,
  })
}

async function tickHeadlessWorker(): Promise<void> {
  if (processing || !isTauriRuntime()) return
  processing = true
  try {
    const jobs = await headlessExportApi.listPending(MAX_JOBS_PER_TICK)
    if (jobs.length === 0) return
    useHeadlessExportWorkerStore.getState().setWorkerBusy(true)
    for (const job of jobs) {
      patchJob(job)
      try {
        await processHeadlessExportJob(job)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Headless 导出失败'
        patchJob({
          ...job,
          status: 'failed',
          progress: 0,
          message: 'Headless 导出失败',
          error: message,
        })
        await headlessExportApi
          .fail(job.project_id, job.session_id, job.job_id, { error: message })
          .catch(() => undefined)
      }
    }
  } catch (error) {
    console.warn('[headless-export-worker]', error)
  } finally {
    processing = false
    useHeadlessExportWorkerStore.getState().setWorkerBusy(false)
  }
}

/** 桌面端后台轮询 Headless queued 任务 */
export function startHeadlessExportWorker(): () => void {
  if (!isTauriRuntime() || workerTimer != null) {
    return () => undefined
  }

  void tickHeadlessWorker()
  workerTimer = window.setInterval(() => {
    void tickHeadlessWorker()
  }, POLL_INTERVAL_MS)

  return () => {
    if (workerTimer != null) {
      window.clearInterval(workerTimer)
      workerTimer = null
    }
  }
}
