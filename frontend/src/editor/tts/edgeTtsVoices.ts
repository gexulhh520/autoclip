/** Edge TTS 中文神经音色（Microsoft Read Aloud，以当前在线列表为准） */
export interface EdgeTtsVoiceOption {
  id: string
  gender: '女' | '男'
  /** 音色名（微软命名） */
  name: string
  /** 适用场景 */
  scene: string
  /** 特点说明 */
  hint: string
}

export const DEFAULT_EDGE_TTS_VOICE = 'zh-CN-XiaoxiaoNeural'

/** 微软已下线的旧 voice id → 当前可用替代 */
export const EDGE_TTS_VOICE_ALIASES: Record<string, string> = {
  'zh-CN-XiaohanNeural': 'zh-CN-liaoning-XiaobeiNeural',
  'zh-CN-XiaomoNeural': 'zh-CN-shaanxi-XiaoniNeural',
  'zh-CN-YunfengNeural': 'zh-CN-YunxiaNeural',
}

export const EDGE_TTS_VOICES_ZH: EdgeTtsVoiceOption[] = [
  {
    id: 'zh-CN-XiaoxiaoNeural',
    gender: '女',
    name: '晓晓',
    scene: '口播主力',
    hint: '清晰自然，适合大多数内容',
  },
  {
    id: 'zh-CN-XiaoyiNeural',
    gender: '女',
    name: '晓伊',
    scene: '温柔情感',
    hint: '语气柔和，适合情感向内容',
  },
  {
    id: 'zh-CN-liaoning-XiaobeiNeural',
    gender: '女',
    name: '晓北',
    scene: '年轻活力',
    hint: '东北女声，语气活泼，适合轻松向口播',
  },
  {
    id: 'zh-CN-shaanxi-XiaoniNeural',
    gender: '女',
    name: '晓妮',
    scene: '情感叙事',
    hint: '陕西女声，表现力较好，适合故事类内容',
  },
  {
    id: 'zh-CN-YunxiNeural',
    gender: '男',
    name: '云希',
    scene: '知识教程',
    hint: '声音稳重，适合知识分享与教程',
  },
  {
    id: 'zh-CN-YunyangNeural',
    gender: '男',
    name: '云扬',
    scene: '专业讲解',
    hint: '讲解感强，适合干货内容',
  },
  {
    id: 'zh-CN-YunjianNeural',
    gender: '男',
    name: '云健',
    scene: '新闻正式',
    hint: '较为严肃，适合新闻与正式场合',
  },
  {
    id: 'zh-CN-YunxiaNeural',
    gender: '男',
    name: '云夏',
    scene: '年轻男声',
    hint: '少年感较强，适合轻松解说',
  },
]

export function resolveEdgeTtsVoiceId(voiceId: string | null | undefined): string {
  const raw = (voiceId ?? '').trim()
  if (!raw) return DEFAULT_EDGE_TTS_VOICE
  if (EDGE_TTS_VOICE_ALIASES[raw]) return EDGE_TTS_VOICE_ALIASES[raw]
  if (EDGE_TTS_VOICES_ZH.some((item) => item.id === raw)) return raw
  return DEFAULT_EDGE_TTS_VOICE
}

export function findEdgeTtsVoice(voiceId: string): EdgeTtsVoiceOption | undefined {
  const resolved = resolveEdgeTtsVoiceId(voiceId)
  return EDGE_TTS_VOICES_ZH.find((item) => item.id === resolved)
}

export function formatEdgeTtsVoiceLabel(voice: EdgeTtsVoiceOption): string {
  return `${voice.gender} · ${voice.name} · ${voice.scene}`
}

export const EDGE_TTS_VOICES_ZH_FEMALE = EDGE_TTS_VOICES_ZH.filter((item) => item.gender === '女')
export const EDGE_TTS_VOICES_ZH_MALE = EDGE_TTS_VOICES_ZH.filter((item) => item.gender === '男')

export const EDGE_TTS_VOICE_IDS = EDGE_TTS_VOICES_ZH.map((item) => item.id)
