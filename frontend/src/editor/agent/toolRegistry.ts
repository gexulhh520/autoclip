/** OpenAI / Ollama 兼容的工具 schema（Phase B 首批） */
export const EDITOR_AGENT_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'seek_playhead',
      description: '将播放头移动到指定时间（秒）',
      parameters: {
        type: 'object',
        properties: { time_sec: { type: 'number' } },
        required: ['time_sec'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_text_overlay',
      description: '在指定时间添加文本层。content 必须来自 draft_texts，禁止抄参考图。role 固定 text。',
      parameters: {
        type: 'object',
        properties: {
          start_sec: { type: 'number' },
          duration_sec: { type: 'number' },
          content: { type: 'string' },
          fontSize: { type: 'number' },
          fontFamily: { type: 'string' },
          color: { type: 'string' },
          fontWeight: { type: 'string' },
          textAlign: { type: 'string' },
          lineHeight: { type: 'number' },
          positionX: { type: 'number' },
          positionY: { type: 'number' },
          scaleX: { type: 'number' },
          scaleY: { type: 'number' },
          rotate: { type: 'number' },
          animation_in_type: { type: 'string' },
          animation_in_duration: { type: 'number' },
        },
        required: ['start_sec', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_overlay_params',
      description: '更新已有文本层样式或位置',
      parameters: {
        type: 'object',
        properties: {
          overlay_id: { type: 'string' },
          content: { type: 'string' },
          fontSize: { type: 'number' },
          fontFamily: { type: 'string' },
          color: { type: 'string' },
          fontWeight: { type: 'string' },
          textAlign: { type: 'string' },
          lineHeight: { type: 'number' },
          positionX: { type: 'number' },
          positionY: { type: 'number' },
          scaleX: { type: 'number' },
          scaleY: { type: 'number' },
          rotate: { type: 'number' },
        },
        required: ['overlay_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_video_transform',
      description: '设置视频片段画面缩放与位移（主轨构图）',
      parameters: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          position_x: { type: 'number' },
          position_y: { type: 'number' },
          scale_x: { type: 'number' },
          scale_y: { type: 'number' },
        },
        required: ['block_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_block_trim',
      description: '更新片段裁切入出点（秒，相对源媒体）',
      parameters: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          in_sec: { type: 'number' },
          out_sec: { type: 'number' },
        },
        required: ['block_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_block_to_video_track',
      description: '将视频片段移动到指定视频轨',
      parameters: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          video_track_id: { type: 'string' },
        },
        required: ['block_id', 'video_track_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_clips_to_timeline',
      description: '从素材池追加 clip 到主轨（缺省主轨末尾）',
      parameters: {
        type: 'object',
        properties: {
          clip_ids: { type: 'array', items: { type: 'string' } },
          source_id: { type: 'string', description: '可选，多源项目' },
          insert_index: { type: 'number', description: '主轨插入下标 0-based，缺省追加' },
        },
        required: ['clip_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reorder_main_track',
      description: '调整主轨片段顺序',
      parameters: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          to_index: { type: 'number', description: '目标主轨下标 0-based' },
        },
        required: ['block_id', 'to_index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_transition',
      description: '设置片段出点转场（作用于 outgoing 片段）',
      parameters: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          transition: {
            type: 'string',
            enum: [
              'cut',
              'dissolve',
              'fade_black',
              'wipe_left',
              'wipe_right',
              'slide_left',
              'slide_right',
              'zoom',
            ],
          },
        },
        required: ['block_id', 'transition'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_audio_clip',
      description: '将 BGM 或 SFX 加到时间线（asset_id 来自 list_assets）',
      parameters: {
        type: 'object',
        properties: {
          asset_id: { type: 'string' },
          start_sec: { type: 'number' },
          duration_sec: { type: 'number' },
          track_id: { type: 'string' },
          volume: { type: 'number' },
          fade_in_sec: { type: 'number' },
          fade_out_sec: { type: 'number' },
          block_id: { type: 'string', description: '可选，联动到视频块' },
        },
        required: ['asset_id', 'start_sec'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_block_audio',
      description: '调整视频片段原声音量与淡化',
      parameters: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          volume: { type: 'number' },
          fade_in_sec: { type: 'number' },
          fade_out_sec: { type: 'number' },
        },
        required: ['block_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_assets',
      description: '只读：列出当前工程可用素材（视频 clip 池、BGM、SFX）',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['clip', 'bgm', 'sfx', 'all'],
            description: '默认 all',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_timeline_summary',
      description: '只读：返回时间线摘要（与 EditorSnapshot 类似）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_block_detail',
      description: '只读：返回单个视频片段详情',
      parameters: {
        type: 'object',
        properties: { block_id: { type: 'string' } },
        required: ['block_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_overlay_detail',
      description: '只读：返回单个文本层详情',
      parameters: {
        type: 'object',
        properties: { overlay_id: { type: 'string' } },
        required: ['overlay_id'],
      },
    },
  },
] as const

export const EDITOR_AGENT_TOOL_NAMES = EDITOR_AGENT_TOOL_DEFINITIONS.map(
  (item) => item.function.name
)

export const READ_ONLY_AGENT_TOOLS = new Set([
  'list_assets',
  'get_timeline_summary',
  'get_block_detail',
  'get_overlay_detail',
])

export const ASYNC_WRITE_AGENT_TOOLS = new Set(['add_clips_to_timeline'])

export function isAsyncWriteAgentTool(name: string): boolean {
  return ASYNC_WRITE_AGENT_TOOLS.has(name)
}

export function isReadOnlyAgentTool(name: string): boolean {
  return READ_ONLY_AGENT_TOOLS.has(name)
}

export function isWriteAgentTool(name: string): boolean {
  return (EDITOR_AGENT_TOOL_NAMES as readonly string[]).includes(name) && !READ_ONLY_AGENT_TOOLS.has(name)
}

export function formatToolCallSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'add_text_overlay':
      return `添加文本「${String(args.content ?? '').slice(0, 24)}」@${args.start_sec ?? 0}s`
    case 'update_overlay_params':
      return `更新文本层 ${args.overlay_id}`
    case 'set_video_transform':
      return `调整视频 ${args.block_id} 构图`
    case 'update_block_trim':
      return `裁切片段 ${args.block_id}`
    case 'move_block_to_video_track':
      return `移动片段 ${args.block_id} → 轨 ${args.video_track_id}`
    case 'add_clips_to_timeline':
      return `追加 ${Array.isArray(args.clip_ids) ? args.clip_ids.length : 0} 个 clip 到主轨`
    case 'reorder_main_track':
      return `主轨排序 ${args.block_id} → #${args.to_index}`
    case 'set_transition':
      return `转场 ${args.block_id} → ${args.transition}`
    case 'add_audio_clip':
      return `添加音频 ${args.asset_id} @${args.start_sec}s`
    case 'update_block_audio':
      return `调整片段原声 ${args.block_id}`
    case 'seek_playhead':
      return `播放头 → ${args.time_sec}s`
    case 'list_assets':
      return `列出素材 (${String(args.category ?? 'all')})`
    default:
      return `${name}(${JSON.stringify(args).slice(0, 60)})`
  }
}
