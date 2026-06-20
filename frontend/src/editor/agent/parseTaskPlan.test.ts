import { describe, expect, it } from 'vitest'
import { parseSubmitTaskPlan } from './parseTaskPlan'

describe('parseSubmitTaskPlan', () => {
  it('parses valid task plan', () => {
    const plan = parseSubmitTaskPlan({
      name: 'submit_task_plan',
      arguments: {
        goal: '竖排拆字并验证',
        tasks: [
          { id: 't1', title: '竖排拆分', hint: 'layout=vertical' },
          { id: 't2', title: '验证字幕' },
        ],
      },
    })
    expect(plan?.goal).toBe('竖排拆字并验证')
    expect(plan?.tasks).toHaveLength(2)
    expect(plan?.tasks[0]?.status).toBe('pending')
  })

  it('returns null for invalid payload', () => {
    expect(parseSubmitTaskPlan({ name: 'submit_task_plan', arguments: { goal: '', tasks: [] } })).toBeNull()
  })
})
