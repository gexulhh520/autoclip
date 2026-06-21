import { describe, expect, it } from 'vitest'
import {
  buildReadOnlyInspectSummary,
  isPerBlockCaptionWriteTask,
  isReadOnlyInspectTask,
  wantsVerticalCaptionLayout,
} from './taskFastPath'
import { isPostCaptionAnimationTask, taskExpectsTimelineWrites } from './taskExecutionGuard'

describe('taskFastPath', () => {
  it('detects read-only inspect tasks', () => {
    expect(
      isReadOnlyInspectTask({ title: '获取当前所有视频片段详情及对应的文本内容' })
    ).toBe(true)
    expect(isReadOnlyInspectTask({ title: '在每段片段加字幕' })).toBe(false)
  })

  it('detects per-block caption write tasks', () => {
    expect(
      isPerBlockCaptionWriteTask(
        { title: '根据各片段内容生成对应文案并添加文本层（包含竖向布局）' },
        '每段视频添加合适的字幕 竖排 带动画'
      )
    ).toBe(true)
  })

  it('builds inspect summary from snapshot blocks', () => {
    const summary = buildReadOnlyInspectSummary({
      blocks: [
        {
          id: 'b1',
          title: '片段1',
          track_id: 'default-video',
          timeline_start_sec: 0,
          overlay_outline: '你好',
          overlay_content_preview: '',
        },
      ],
    } as ReturnType<typeof import('./snapshotFromStore').buildEditorSnapshotFromStore>)
    expect(summary).toContain('已识别 1 个主轨片段')
    expect(summary).toContain('b1')
  })

  it('detects vertical layout intent', () => {
    expect(wantsVerticalCaptionLayout('竖排 带动画')).toBe(true)
  })

  it('skips post-caption animation when captions already added', () => {
    const task = { title: '为新生成的文本层添加入场动画' }
    const summaries = ['[t2] 加字幕: 已为 3 段添加竖排字幕']
    expect(isPostCaptionAnimationTask(task, summaries)).toBe(true)
    expect(taskExpectsTimelineWrites(task, summaries)).toBe(false)
  })
})
