import React from 'react'

interface TimelineHorizontalScrollbarProps {
  scrollLeft: number
  maxScrollLeft: number
  canScroll: boolean
  onScrollLeftChange: (left: number) => void
}

/** 时间线底部始终可见的横向滚动条（替代易被系统隐藏的原生滚动条） */
const TimelineHorizontalScrollbar: React.FC<TimelineHorizontalScrollbarProps> = ({
  scrollLeft,
  maxScrollLeft,
  canScroll,
  onScrollLeftChange,
}) => {
  const clampedValue = Math.min(scrollLeft, maxScrollLeft)

  return (
    <div
      className={`oc-timeline__h-scroll${canScroll ? ' has-overflow' : ''}`}
      title={canScroll ? '横向滚动时间线' : undefined}
    >
      <input
        type="range"
        className="oc-timeline__h-scroll-range"
        min={0}
        max={Math.max(maxScrollLeft, 1)}
        step={1}
        value={canScroll ? clampedValue : 0}
        disabled={!canScroll}
        onChange={(event) => onScrollLeftChange(Number(event.target.value))}
        aria-label="时间线横向滚动"
      />
    </div>
  )
}

export default TimelineHorizontalScrollbar
