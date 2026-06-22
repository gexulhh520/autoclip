import React from 'react'
import type { AgentChatTurn } from '../../../types/editorAgent'
import AgentSearchProgressView from './AgentSearchProgressView'

const MATCH_LINE =
  /^-\s+(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s（(画面|文本)，匹配 (\d+)%）/

const AgentPlainContent: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n')
  const blocks: React.ReactNode[] = []
  let listItems: string[] = []

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push(
      <ul key={`list-${blocks.length}`} className="agent-chat-plain__list">
        {listItems.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    )
    listItems = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      continue
    }
    if (trimmed.startsWith('- ')) {
      listItems.push(trimmed.slice(2))
      continue
    }
    flushList()
    blocks.push(
      <p key={`p-${blocks.length}`} className="agent-chat-plain__p">
        {trimmed}
      </p>
    )
  }
  flushList()

  return <div className="agent-chat-plain">{blocks}</div>
}

const AgentMomentSearchResult: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n').filter((line) => line.trim())
  const header = lines[0] ?? ''
  const matches: Array<{ range: string; source: string; score: number; preview?: string }> = []
  const noteLines: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    const match = line.match(MATCH_LINE)
    if (match) {
      matches.push({
        range: `${match[1]}–${match[2]}s`,
        source: match[3],
        score: Number(match[4]),
      })
      const previewLine = lines[i + 1]?.trim()
      if (previewLine && !previewLine.startsWith('-') && !previewLine.startsWith('理由：')) {
        matches[matches.length - 1].preview = previewLine
        i += 1
      }
      continue
    }
    if (line.startsWith('理由：') && matches.length > 0) continue
    noteLines.push(line)
  }

  if (matches.length === 0) {
    return <AgentPlainContent content={content} />
  }

  return (
    <div className="agent-search-result">
      <p className="agent-search-result__header">{header}</p>
      <ul className="agent-search-result__matches">
        {matches.map((item, index) => (
          <li key={index} className="agent-search-result__match">
            <div className="agent-search-result__match-head">
              <span className="agent-search-result__time">{item.range}</span>
              <span className="agent-search-result__meta">
                {item.source} · {item.score}%
              </span>
            </div>
            {item.preview ? (
              <p className="agent-search-result__preview">{item.preview}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {noteLines.length > 0 ? (
        <p className="agent-search-result__note">{noteLines.join(' ')}</p>
      ) : null}
    </div>
  )
}

const AgentChatBubbleContent: React.FC<{ turn: AgentChatTurn }> = ({ turn }) => {
  if (turn.searchProgress) {
    return <AgentSearchProgressView progress={turn.searchProgress} />
  }

  const firstListLine = turn.content.split('\n').find((line) => line.trim().startsWith('- ')) ?? ''
  if (turn.role === 'assistant' && MATCH_LINE.test(firstListLine)) {
    return <AgentMomentSearchResult content={turn.content} />
  }

  if (turn.role === 'assistant' && turn.content.includes('\n- ')) {
    return <AgentPlainContent content={turn.content} />
  }

  return <p className="agent-chat-plain__p">{turn.content}</p>
}

export default AgentChatBubbleContent
