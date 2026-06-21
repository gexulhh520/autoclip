/** OpenAI / Ollama 兼容的工具 schema（Phase B 首批） */

export const META_AGENT_TOOLS = new Set(['submit_task_plan'])

export function isMetaAgentTool(name: string): boolean {
  return META_AGENT_TOOLS.has(name)
}

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
      name: 'apply_caption_template',
      description:
        '批量添加/替换字幕（推荐）。加字幕用 entries+layout+position；改横竖排时 replace_existing=true（引擎先删旧字幕再重建，text 可省略）。禁止 positionX/Y/fontSize/start_sec。',
      parameters: {
        type: 'object',
        properties: {
          layout: {
            type: 'string',
            enum: ['horizontal', 'vertical'],
            description: 'horizontal=横排整句；vertical=竖排逐字+动画',
          },
          position: {
            type: 'string',
            enum: [
              'top_left',
              'top_center',
              'top_right',
              'center_left',
              'center',
              'center_right',
              'bottom_left',
              'bottom_center',
              'bottom_right',
            ],
            description:
              '字幕锚点：top/bottom/center/偏左/偏右/四角等。默认 bottom_center。引擎自动换算安全区坐标。',
          },
          template: {
            type: 'string',
            enum: ['vertical_stagger', 'horizontal_center', 'bottom_safe', 'top_safe'],
            description: '【可选兼容】等价于 layout+position 组合，优先用 layout+position',
          },
          entries: {
            type: 'array',
            description: '每段字幕：block_id 须来自 known_blocks',
            items: {
              type: 'object',
              properties: {
                block_id: { type: 'string' },
                text: {
                  type: 'string',
                  description: '字幕正文；replace_existing=true 时可省略，引擎从旧字幕合并',
                },
              },
              required: ['block_id'],
            },
          },
          style: {
            type: 'object',
            properties: {
              fontFamily: { type: 'string' },
              color: { type: 'string' },
              fontWeight: { type: 'string' },
            },
          },
          animation: {
            type: 'object',
            properties: {
              in_type: {
                type: 'string',
                enum: ['none', 'fade', 'slide_up', 'slide_down', 'scale', 'pop'],
              },
              in_duration_sec: { type: 'number' },
              stagger_sec: { type: 'number', description: '竖排逐字间隔（秒）' },
            },
          },
          skip_existing: { type: 'boolean', description: '默认 true；replace_existing=true 时忽略' },
          replace_existing: {
            type: 'boolean',
            description: 'true=改布局/换横竖排：先删该片段现有字幕再按 layout 重建',
          },
        },
        required: ['entries'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_block_captions',
      description:
        '删除指定视频片段的字幕（含竖排单字层与模板字幕），并清空该片段 draft 文案。block_ids 须来自 known_blocks。',
      parameters: {
        type: 'object',
        properties: {
          block_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '要清空字幕的主轨片段 id 列表',
          },
        },
        required: ['block_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_all_captions',
      description: '删除主轨所有片段的字幕层（含竖排拆字），并清空各片段 draft 文案。纯删除，不添加新字幕。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_text_overlay',
      description:
        '【不推荐 Agent 使用】单条文本层。批量字幕请用 apply_caption_template。仅当用户明确指定某一时刻的单条文字时使用。',
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
      name: 'set_visual_filter',
      description:
        '设置整片视觉滤镜（预览与导出全局生效，非单片段）。高对比=mono_contrast；柔和单色=mono_soft；冷色=mono_cool；暖色=mono_warm；取消=none。勿用 set_video_transform。',
      parameters: {
        type: 'object',
        properties: {
          visual_filter: {
            type: 'string',
            enum: ['none', 'mono_soft', 'mono_contrast', 'mono_cool', 'mono_warm'],
            description: '也可用中文：高对比、柔和单色、冷色克制、暖色克制',
          },
        },
        required: ['visual_filter'],
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
      name: 'detect_silence_trim',
      description: '检测片段内静音并建议或应用 trim（收紧口播节奏）',
      parameters: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          apply: { type: 'boolean', description: 'true 直接裁切，false 仅返回建议' },
          noise_db: { type: 'number' },
          min_silence_sec: { type: 'number' },
        },
        required: ['block_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'split_block_at_playhead',
      description: '在播放头位置切分当前选中的视频/文本/音频（需先 seek_playhead）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_block',
      description: '删除视频片段（危险操作）',
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
      name: 'split_text_overlay_by_char',
      description:
        '将单个文本层按字拆成多层并带入场动画。layout=horizontal 横排逐字出现；layout=vertical 竖排（自上而下，屏幕居中）。会删除原层。',
      parameters: {
        type: 'object',
        properties: {
          overlay_id: {
            type: 'string',
            description: '缺省用 selected_overlay_id 或唯一/最近文本层',
          },
          layout: {
            type: 'string',
            enum: ['horizontal', 'vertical'],
            description: 'horizontal=横排逐字出现；vertical=竖排竖版，默认 horizontal',
          },
          stagger_sec: { type: 'number', description: '字与字之间的出现间隔，默认 0.28' },
          char_duration_sec: { type: 'number', description: '单字层时长，默认沿用原层' },
          in_type: {
            type: 'string',
            enum: ['none', 'fade', 'slide_up', 'slide_down', 'scale', 'pop'],
            description: '每字入场动画，默认 pop',
          },
          in_duration_sec: { type: 'number', description: '入场动画时长，默认 0.35' },
          center_x: { type: 'number', description: '竖排时水平位置 0–1，0.5=正中' },
          center_y: { type: 'number', description: '整列/横排垂直位置 0–1，0.5=正中' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'split_text_overlays_by_char',
      description:
        '批量将多个≥2字的整句文本层按字拆分。overlay_ids 来自 known_overlays。改全片横竖排请用 apply_caption_template(replace_existing=true)，勿用本工具（已是单字层会跳过）。',
      parameters: {
        type: 'object',
        properties: {
          overlay_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '要拆分的 overlay_id 列表；缺省自动选所有≥2字的文本层',
          },
          layout: {
            type: 'string',
            enum: ['horizontal', 'vertical'],
          },
          stagger_sec: { type: 'number' },
          char_duration_sec: { type: 'number' },
          in_type: {
            type: 'string',
            enum: ['none', 'fade', 'slide_up', 'slide_down', 'scale', 'pop'],
          },
          in_duration_sec: { type: 'number' },
          center_x: { type: 'number' },
          center_y: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_text_animation',
      description: '设置文本层入场/出场动画（不含改 content）',
      parameters: {
        type: 'object',
        properties: {
          overlay_id: { type: 'string' },
          in_type: {
            type: 'string',
            enum: ['none', 'fade', 'slide_up', 'slide_down', 'scale', 'pop'],
          },
          in_duration_sec: { type: 'number' },
          out_type: {
            type: 'string',
            enum: ['none', 'fade', 'slide_up', 'slide_down', 'scale', 'pop'],
          },
          out_duration_sec: { type: 'number' },
        },
        required: ['overlay_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_apply_text_style',
      description: '批量统一文本层样式（不含改 content）',
      parameters: {
        type: 'object',
        properties: {
          overlay_ids: { type: 'array', items: { type: 'string' }, description: '缺省=全部文本层' },
          fontSize: { type: 'number' },
          fontFamily: { type: 'string' },
          color: { type: 'string' },
          fontWeight: { type: 'string' },
          textAlign: { type: 'string' },
        },
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
      name: 'verify_subtitle_in_frame',
      description:
        '只读：在字幕出现时刻截帧，委派画面分析子 Agent 检查字幕是否超出画面；返回简短 JSON（不含 JPEG），用于改位置后的验证反馈',
      parameters: {
        type: 'object',
        properties: {
          overlay_id: { type: 'string', description: '缺省用 selected_overlay_id 或最近文本层' },
          time_sec: { type: 'number', description: '缺省取 overlay start_sec + 0.2s' },
          max_width: { type: 'number', description: '截帧最大宽，默认 720' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_block_content',
      description:
        '只读：分析视频片段内容。均匀抽帧后每帧单独视觉分析（并发），音频分段单独节奏分析（并发），最后文本汇总；返回 summary、关键画面、剪辑建议。block_id 缺省用 focused_block_id 或 selected_block_id',
      parameters: {
        type: 'object',
        properties: {
          block_id: { type: 'string', description: '目标片段；缺省用 AI 钉住或当前选中片段' },
          frame_sample_count: {
            type: 'number',
            description:
              '抽帧数量 3–96；缺省按片段时长自动（约每 45–90s 一帧，1 小时约 72 帧）。显式指定可加快短片段分析',
          },
          include_audio_analysis: {
            type: 'boolean',
            description: '是否做音频静音分段，默认 true',
          },
          include_existing_text: {
            type: 'boolean',
            description: '是否附带已有字幕/文案对照，默认 true',
          },
          user_question: { type: 'string', description: '针对该片段的具体问题' },
          max_width: { type: 'number', description: '抽帧最大宽，默认 720' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'capture_preview_frame',
      description: '只读：截帧调试（主 Agent 看不到 JPEG）；优先用 verify_subtitle_in_frame',
      parameters: {
        type: 'object',
        properties: {
          time_sec: { type: 'number' },
          max_width: { type: 'number', description: '缩略图最大宽，默认 720' },
        },
        required: ['time_sec'],
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
  {
    type: 'function',
    function: {
      name: 'submit_task_plan',
      description:
        '提交多步骤任务计划（不修改时间线）。用户需求含≥2个独立步骤时必须先调用；tasks 按执行顺序排列。',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '总体目标简述' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                hint: { type: 'string', description: '可选：建议使用的工具或注意事项' },
              },
              required: ['id', 'title'],
            },
          },
        },
        required: ['goal', 'tasks'],
      },
    },
  },
] as const

export const EDITOR_AGENT_TOOL_NAMES = EDITOR_AGENT_TOOL_DEFINITIONS.map(
  (item) => item.function.name
)

export const LEGACY_WRITE_AGENT_TOOLS = new Set(['add_captions_for_blocks'])

export const BATCH_AUTO_WRITE_TOOLS_FRONTEND = new Set([
  'apply_caption_template',
  'add_captions_for_blocks',
  'clear_block_captions',
  'clear_all_captions',
  'split_text_overlay_by_char',
  'split_text_overlays_by_char',
  'batch_apply_text_style',
])

export const READ_ONLY_AGENT_TOOLS = new Set([
  'list_assets',
  'verify_subtitle_in_frame',
  'analyze_block_content',
  'capture_preview_frame',
  'get_timeline_summary',
  'get_block_detail',
  'get_overlay_detail',
])

export const ASYNC_WRITE_AGENT_TOOLS = new Set(['add_clips_to_timeline', 'detect_silence_trim'])

export const DANGEROUS_AGENT_TOOLS = new Set(['remove_block'])

export function isAsyncWriteAgentTool(name: string): boolean {
  return ASYNC_WRITE_AGENT_TOOLS.has(name)
}

export function isDangerousAgentTool(name: string): boolean {
  return DANGEROUS_AGENT_TOOLS.has(name)
}

export function isReadOnlyAgentTool(name: string): boolean {
  return READ_ONLY_AGENT_TOOLS.has(name)
}

export function isWriteAgentTool(name: string): boolean {
  return (
    ((EDITOR_AGENT_TOOL_NAMES as readonly string[]).includes(name) ||
      LEGACY_WRITE_AGENT_TOOLS.has(name)) &&
    !READ_ONLY_AGENT_TOOLS.has(name) &&
    !isMetaAgentTool(name)
  )
}

export function formatToolCallSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'add_text_overlay':
      return `添加文本「${String(args.content ?? '').slice(0, 24)}」@${args.start_sec ?? 0}s`
    case 'apply_caption_template': {
      const entries = Array.isArray(args.entries) ? args.entries.length : 0
      const layout = String(args.layout ?? args.template ?? 'horizontal')
      const position = String(args.position ?? 'bottom_center')
      return `模板字幕 ${layout}/${position} × ${entries} 段`
    }
    case 'clear_block_captions': {
      const count = Array.isArray(args.block_ids) ? args.block_ids.length : 0
      return `删除 ${count} 个片段字幕`
    }
    case 'clear_all_captions':
      return '删除主轨全部字幕'
    case 'add_captions_for_blocks': {
      const layout = args.layout === 'vertical' ? '竖排' : '横排'
      const blocks = Array.isArray(args.block_ids) ? args.block_ids.length : '全部片段'
      return `每段字幕「${String(args.content ?? '').slice(0, 16)}」(${blocks}) ${layout}`
    }
    case 'update_overlay_params':
      return `更新文本层 ${args.overlay_id}`
    case 'set_video_transform':
      return `调整视频 ${args.block_id} 构图`
    case 'set_visual_filter':
      return `设置滤镜 ${String(args.visual_filter ?? '')}`
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
    case 'detect_silence_trim':
      return `${args.apply === false ? '检测' : '去气口'} ${args.block_id}`
    case 'split_block_at_playhead':
      return '在播放头位置切分'
    case 'remove_block':
      return `⚠ 删除片段 ${args.block_id}`
    case 'set_text_animation':
      return `文本动画 ${args.overlay_id}`
    case 'split_text_overlay_by_char':
      return `逐字拆分文本层 ${args.overlay_id ?? '（自动）'}${args.layout === 'vertical' ? ' · 竖排' : ''}`
    case 'split_text_overlays_by_char': {
      const count = Array.isArray(args.overlay_ids) ? args.overlay_ids.length : '全部可拆分'
      return `批量逐字拆分 (${count})${args.layout === 'vertical' ? ' · 竖排' : ''}`
    }
    case 'batch_apply_text_style':
      return `批量文本样式 (${Array.isArray(args.overlay_ids) ? args.overlay_ids.length : '全部'})`
    case 'seek_playhead':
      return `播放头 → ${args.time_sec}s`
    case 'list_assets':
      return `列出素材 (${String(args.category ?? 'all')})`
    case 'verify_subtitle_in_frame':
      return `验证字幕帧 ${args.overlay_id ?? '（自动）'}`
    case 'analyze_block_content':
      return `分析片段内容 ${args.block_id ?? '（自动）'}`
    case 'capture_preview_frame':
      return `截帧 @${args.time_sec}s`
    case 'submit_task_plan': {
      const tasks = Array.isArray(args.tasks) ? args.tasks.length : 0
      return `任务计划「${String(args.goal ?? '').slice(0, 32)}」(${tasks} 步)`
    }
    default:
      return `${name}(${JSON.stringify(args).slice(0, 60)})`
  }
}
