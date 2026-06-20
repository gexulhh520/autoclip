import type { TextElementParams } from './params'

const defaultTransform = {
  scaleX: 1,
  scaleY: 1,
  positionX: 0,
  positionY: 0,
  rotate: 0,
}

const defaultTextBackground = {
  enabled: false,
  color: '#000000',
  cornerRadius: 0,
  paddingX: 30,
  paddingY: 42,
  offsetX: 0,
  offsetY: 0,
}

export const OPENCUT_TEXT_DEFAULTS = {
  letterSpacing: 0,
  lineHeight: 1.2,
  background: defaultTextBackground,
  params: {
    content: '新文本',
    fontSize: 6,
    fontFamily: 'Noto Sans SC',
    color: '#ffffff',
    textAlign: 'center',
    fontWeight: 'normal',
    fontStyle: 'normal',
    textDecoration: 'none',
    letterSpacing: 0,
    lineHeight: 1.2,
    'background.enabled': false,
    'background.color': '#000000',
    'background.cornerRadius': 0,
    'background.paddingX': 30,
    'background.paddingY': 42,
    'background.offsetX': 0,
    'background.offsetY': 0,
    'transform.positionX': defaultTransform.positionX,
    'transform.positionY': defaultTransform.positionY,
    'transform.scaleX': defaultTransform.scaleX,
    'transform.scaleY': defaultTransform.scaleY,
    'transform.rotate': defaultTransform.rotate,
    opacity: 1,
    blendMode: 'normal',
  } satisfies TextElementParams,
}
