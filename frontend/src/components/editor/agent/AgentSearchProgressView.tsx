import React from 'react'
import type { FindBlockMomentsProgress } from '../../../types/editorAgent'

function formatTimecode(sec: number): string {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
  }
  if (sec >= 60) {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${s.toFixed(1).padStart(4, '0')}`
  }
  return `${sec.toFixed(1)}s`
}

function formatRegion(start: number, end: number): string {
  return `${formatTimecode(start)}–${formatTimecode(end)}`
}

function phaseMeta(progress: FindBlockMomentsProgress): { label: string; detail?: string } {
  if (progress.scanPhase === 'planner') {
    return { label: '理解检索目标', detail: 'Planner' }
  }
  if (progress.coarseSkipped) {
    return { label: '精扫', detail: '短视频跳过粗筛' }
  }
  if (progress.scanPhase === 'coarse') {
    return { label: '粗筛', detail: '60s/窗 · 6 帧 · 并行' }
  }
  if (progress.scanPhase === 'fine') {
    return { label: '精扫', detail: '16s/窗 · 仅热点区' }
  }
  return { label: '检索', detail: undefined }
}

const AgentSearchProgressView: React.FC<{ progress: FindBlockMomentsProgress }> = ({
  progress,
}) => {
  const meta = phaseMeta(progress)
  const isActive = progress.phase !== 'done'
  const ratio =
    progress.totalWindows > 0
      ? Math.min(100, Math.round((progress.windowsProcessed / progress.totalWindows) * 100))
      : 0
  const counter =
    progress.totalWindows > 0
      ? `${progress.windowsProcessed}/${progress.totalWindows}`
      : '…'

  return (
    <div className="agent-search-progress">
      <div className="agent-search-progress__head">
        <div className="agent-search-progress__title-row">
          <span className="agent-search-progress__phase">{meta.label}</span>
          {isActive ? <span className="agent-search-progress__live">进行中</span> : null}
        </div>
        <span className="agent-search-progress__counter">{counter}</span>
      </div>

      {meta.detail ? (
        <p className="agent-search-progress__detail">{meta.detail}</p>
      ) : null}

      {progress.totalWindows > 0 ? (
        <div className="agent-search-progress__bar-wrap">
          <div className="agent-search-progress__bar" style={{ width: `${ratio}%` }} />
        </div>
      ) : null}

      {progress.searchSpec?.search_description ? (
        <p className="agent-search-progress__goal">
          {progress.searchSpec.search_description.slice(0, 160)}
        </p>
      ) : null}

      {progress.coarseHits.length > 0 ? (
        <section className="agent-search-progress__section">
          <h4 className="agent-search-progress__section-title">
            粗筛命中 <span className="agent-search-progress__count">{progress.coarseHits.length}</span>
          </h4>
          <ul className="agent-search-progress__list">
            {progress.coarseHits.slice(0, 10).map((hit) => (
              <li key={`${hit.start_sec}-${hit.end_sec}`}>
                <span className="agent-search-progress__time">
                  {formatRegion(hit.start_sec, hit.end_sec)}
                </span>
                <span className="agent-search-progress__score">
                  {Math.round(hit.score * 100)}%
                </span>
                {hit.summary ? (
                  <span className="agent-search-progress__summary">{hit.summary.slice(0, 72)}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {progress.coarseHits.length > 10 ? (
            <p className="agent-search-progress__more">另有 {progress.coarseHits.length - 10} 窗</p>
          ) : null}
        </section>
      ) : null}

      {progress.hotspotRegions.length > 0 ? (
        <section className="agent-search-progress__section">
          <h4 className="agent-search-progress__section-title">
            精扫范围{' '}
            <span className="agent-search-progress__count">{progress.hotspotRegions.length}</span>
          </h4>
          <ul className="agent-search-progress__list agent-search-progress__list--compact">
            {progress.hotspotRegions.slice(0, 6).map((region) => (
              <li key={`${region.start_sec}-${region.end_sec}`}>
                <span className="agent-search-progress__time">
                  {formatRegion(region.start_sec, region.end_sec)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {progress.scanPhase === 'fine' && progress.fineScanRegions.length > 0 ? (
        <p className="agent-search-progress__footnote">
          将分析 {progress.fineScanRegions.length} 个 16s 窗口
        </p>
      ) : null}

      {progress.matches.length > 0 ? (
        <section className="agent-search-progress__section">
          <h4 className="agent-search-progress__section-title">
            已合并 <span className="agent-search-progress__count">{progress.matches.length}</span>
          </h4>
          <ul className="agent-search-progress__list">
            {progress.matches.slice(0, 6).map((match) => (
              <li key={`${match.timeline_start_sec}-${match.timeline_end_sec}`}>
                <span className="agent-search-progress__time">
                  {formatRegion(match.timeline_start_sec, match.timeline_end_sec)}
                </span>
                <span className="agent-search-progress__score">
                  {Math.round(match.match_score * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export default AgentSearchProgressView
