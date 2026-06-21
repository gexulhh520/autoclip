import { describe, expect, it } from 'vitest'
import {
  isGenericTaskCompletionMessage,
  taskExpectsTimelineWrites,
} from './taskExecutionGuard'

describe('taskExecutionGuard', () => {
  it('detects write intent tasks', () => {
    expect(taskExpectsTimelineWrites({ title: '在每段片段加字幕「我很好」' })).toBe(true)
    expect(taskExpectsTimelineWrites({ title: '识别 overlay_id' })).toBe(false)
  })

  it('flags generic completion messages', () => {
    expect(isGenericTaskCompletionMessage('已完成。')).toBe(true)
    expect(isGenericTaskCompletionMessage('已为 3 段添加竖排字幕')).toBe(false)
  })
})
