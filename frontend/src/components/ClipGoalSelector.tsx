import React, { useEffect, useState } from 'react'
import { Typography } from 'antd'
import { projectApi, ClipGoal, ClipGoalSelection } from '../services/api'

const { Text } = Typography

interface ClipGoalSelectorProps {
  value: ClipGoalSelection
  onChange: (value: ClipGoalSelection) => void
}

const ClipGoalSelector: React.FC<ClipGoalSelectorProps> = ({ value, onChange }) => {
  const [goals, setGoals] = useState<ClipGoal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const response = await projectApi.getClipGoals()
        setGoals(response.goals)
        if (!value.clip_goal && response.default_goal) {
          onChange({ clip_goal: response.default_goal })
        }
      } catch (error) {
        console.error('Failed to load clip goals:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const selected = value.clip_goal || 'knowledge'

  if (loading && goals.length === 0) {
    return null
  }

  return (
    <div style={{ marginBottom: '16px' }}>
      <Text strong style={{ color: '#ffffff', fontSize: '14px', marginBottom: '8px', display: 'block' }}>
        剪辑目标
      </Text>
      <Text style={{ color: 'var(--ac-sub)', fontSize: '12px', display: 'block', marginBottom: '10px' }}>
        决定 AI 找什么片段：金句、干货话题或直播高能等
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {goals.map((goal) => {
          const isSelected = selected === goal.id
          return (
            <div
              key={goal.id}
              onClick={() => onChange({ clip_goal: goal.id })}
              style={{
                padding: '10px 14px',
                borderRadius: '6px',
                border: isSelected ? '2px solid var(--ac-accent, #2D6BFF)' : '2px solid var(--ac-line)',
                background: isSelected ? 'rgba(45, 107, 255, 0.12)' : 'var(--ac-line)',
                color: isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.85)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                maxWidth: '220px',
                userSelect: 'none',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: isSelected ? 600 : 400 }}>{goal.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--ac-sub)', marginTop: '4px', lineHeight: 1.4 }}>
                {goal.description}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ClipGoalSelector
