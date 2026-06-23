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
  group: EdgeTtsVoiceGroupId
}

export type EdgeTtsVoiceGroupId =
  | 'mandarin_female'
  | 'mandarin_male'
  | 'dialect'
  | 'cantonese'
  | 'taiwan'

export const EDGE_TTS_VOICE_GROUP_LABELS: Record<EdgeTtsVoiceGroupId, string> = {
  mandarin_female: '普通话 · 女声',
  mandarin_male: '普通话 · 男声',
  dialect: '中文方言',
  cantonese: '粤语',
  taiwan: '台湾国语',
}

export const EDGE_TTS_VOICE_GROUP_ORDER: EdgeTtsVoiceGroupId[] = [
  'mandarin_female',
  'mandarin_male',
  'dialect',
  'cantonese',
  'taiwan',
]

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
    hint: '温暖自然，新闻/小说感，适合大多数内容',
    group: 'mandarin_female',
  },
  {
    id: 'zh-CN-XiaoyiNeural',
    gender: '女',
    name: '晓伊',
    scene: '活泼情感',
    hint: '语气活泼，偏卡通/小说感',
    group: 'mandarin_female',
  },
  {
    id: 'zh-CN-YunxiNeural',
    gender: '男',
    name: '云希',
    scene: '阳光知识',
    hint: '阳光 lively，适合教程与解说',
    group: 'mandarin_male',
  },
  {
    id: 'zh-CN-YunxiaNeural',
    gender: '男',
    name: '云夏',
    scene: '少年男声',
    hint: '偏可爱少年感，适合轻松内容',
    group: 'mandarin_male',
  },
  {
    id: 'zh-CN-YunyangNeural',
    gender: '男',
    name: '云扬',
    scene: '新闻专业',
    hint: '专业可靠，新闻/正式讲解',
    group: 'mandarin_male',
  },
  {
    id: 'zh-CN-YunjianNeural',
    gender: '男',
    name: '云健',
    scene: '激情叙述',
    hint: '富有激情，适合体育/故事叙述',
    group: 'mandarin_male',
  },
  {
    id: 'zh-CN-liaoning-XiaobeiNeural',
    gender: '女',
    name: '晓北',
    scene: '东北方言',
    hint: '东北口音女声，幽默活泼',
    group: 'dialect',
  },
  {
    id: 'zh-CN-shaanxi-XiaoniNeural',
    gender: '女',
    name: '晓妮',
    scene: '陕西方言',
    hint: '陕西口音女声，明亮有表现力',
    group: 'dialect',
  },
  {
    id: 'zh-HK-HiuGaaiNeural',
    gender: '女',
    name: '晓佳',
    scene: '粤语女声',
    hint: '粤语通用女声，友好自然',
    group: 'cantonese',
  },
  {
    id: 'zh-HK-HiuMaanNeural',
    gender: '女',
    name: '晓曼',
    scene: '粤语女声',
    hint: '粤语通用女声，亲切柔和',
    group: 'cantonese',
  },
  {
    id: 'zh-HK-WanLungNeural',
    gender: '男',
    name: '云龙',
    scene: '粤语男声',
    hint: '粤语通用男声，友好自然',
    group: 'cantonese',
  },
  {
    id: 'zh-TW-HsiaoChenNeural',
    gender: '女',
    name: '晓臻',
    scene: '台湾女声',
    hint: '台湾国语女声，Friendly 风格',
    group: 'taiwan',
  },
  {
    id: 'zh-TW-HsiaoYuNeural',
    gender: '女',
    name: '晓雨',
    scene: '台湾女声',
    hint: '台湾国语女声，柔和亲切',
    group: 'taiwan',
  },
  {
    id: 'zh-TW-YunJheNeural',
    gender: '男',
    name: '云哲',
    scene: '台湾男声',
    hint: '台湾国语男声，清晰自然',
    group: 'taiwan',
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

export function getEdgeTtsVoiceGroups(): Array<{
  id: EdgeTtsVoiceGroupId
  label: string
  voices: EdgeTtsVoiceOption[]
}> {
  return EDGE_TTS_VOICE_GROUP_ORDER.map((id) => ({
    id,
    label: EDGE_TTS_VOICE_GROUP_LABELS[id],
    voices: EDGE_TTS_VOICES_ZH.filter((item) => item.group === id),
  })).filter((group) => group.voices.length > 0)
}

/** @deprecated 使用 getEdgeTtsVoiceGroups */
export const EDGE_TTS_VOICES_ZH_FEMALE = EDGE_TTS_VOICES_ZH.filter((item) => item.gender === '女')
/** @deprecated 使用 getEdgeTtsVoiceGroups */
export const EDGE_TTS_VOICES_ZH_MALE = EDGE_TTS_VOICES_ZH.filter((item) => item.gender === '男')

export const EDGE_TTS_VOICE_IDS = EDGE_TTS_VOICES_ZH.map((item) => item.id)
