import type { EditSession } from '../../types/editSession'
import type { PendingAgentPlan } from '../../types/editorAgent'
import { tryBuildLocalOverlayLayoutFixPlan } from './overlayLayoutFix'
import { tryBuildLocalOverlayFontPlan } from './resolveOverlayStyleRequest'

export function tryBuildLocalOverlayPlan(input: {
  userMessage: string
  session: EditSession | null
  selectedOverlayId: string | null
  canvasWidth: number
  canvasHeight: number
}): PendingAgentPlan | null {
  const layoutPlan = tryBuildLocalOverlayLayoutFixPlan(input)
  if (layoutPlan) return layoutPlan
  return tryBuildLocalOverlayFontPlan({
    userMessage: input.userMessage,
    session: input.session,
    selectedOverlayId: input.selectedOverlayId,
  })
}
