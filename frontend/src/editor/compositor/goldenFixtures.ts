import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EditSession } from '../../types/editSession'
import type { CompositionPlan, FrameDescriptor } from './types'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** Repo root `fixtures/compositor` */
export const COMPOSITOR_FIXTURES_ROOT = join(MODULE_DIR, '../../../../fixtures/compositor')

export const COMPOSITOR_GOLDEN_DIR = join(COMPOSITOR_FIXTURES_ROOT, 'golden')

const GOLDEN_COMPILED_AT = 'fixture-compiled-at'

export function loadFixtureSession(filename: string): EditSession {
  const raw = readFileSync(join(COMPOSITOR_FIXTURES_ROOT, filename), 'utf8')
  return JSON.parse(raw) as EditSession
}

export function normalizeCompositionPlanForGolden(plan: CompositionPlan): CompositionPlan {
  return {
    ...plan,
    metadata: {
      ...plan.metadata,
      compiledAt: GOLDEN_COMPILED_AT,
    },
  }
}

export function normalizeFrameDescriptorForGolden(descriptor: FrameDescriptor): FrameDescriptor {
  return descriptor
}

export function canonicalizeCompositionPlanJson(plan: CompositionPlan): string {
  return `${JSON.stringify(normalizeCompositionPlanForGolden(plan), null, 2)}\n`
}

export function canonicalizeFrameDescriptorJson(descriptor: FrameDescriptor): string {
  return `${JSON.stringify(normalizeFrameDescriptorForGolden(descriptor), null, 2)}\n`
}
