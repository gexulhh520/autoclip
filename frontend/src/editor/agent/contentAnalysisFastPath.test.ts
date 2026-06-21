import { describe, expect, it } from 'vitest'
import {
  formatContentAnalysisReply,
  isContentAnalysisRequest,
} from './contentAnalysisFastPath'
import type { AnalyzeBlockContentResult } from './analyzeBlockContent'

describe('contentAnalysisFastPath', () => {
  it('detects content analysis questions', () => {
    expect(isContentAnalysisRequest('分析视频内容说的什么')).toBe(true)
    expect(isContentAnalysisRequest('这段讲什么')).toBe(true)
    expect(isContentAnalysisRequest('给这段加字幕')).toBe(false)
  })

  it('formats analysis reply for chat', () => {
    const text = formatContentAnalysisReply({
      block_id: 'b1',
      block_title: '长视频',
      duration_sec: 120,
      timeline_start_sec: 0,
      timeline_end_sec: 120,
      sample_times_sec: [40, 80],
      trim: { in_sec: 0, out_sec: 120 },
      visual_analysis: {
        summary: '口播讲解产品功能，穿插产品特写。',
        subjects: ['讲解者', '产品'],
        scene_types: ['talking_head'],
        visual_pacing: 'medium',
        mood: '专业',
        key_moments: [{ time_sec: 10, description: '开场自我介绍' }],
        editing_suggestions: ['可在 30s 处加章节标题'],
        confidence: 'high',
        frame_observations: [],
      },
      note: '',
    } as AnalyzeBlockContentResult)
    expect(text).toContain('长视频')
    expect(text).toContain('口播讲解产品功能')
    expect(text).toContain('开场自我介绍')
  })
})
