export const SELECTED_TEMPLATE_STORAGE_KEY = 'autoclip.selectedGeneTemplate'

export const TEMPLATE_LABELS: Record<string, string> = {
  golden_quote_cinema: '经典影视金句',
  knowledge_digest: '知识干货精选',
}

export function getProjectTemplateId(project: {
  settings?: Record<string, unknown> | null
  processing_config?: Record<string, unknown> | null
}): string | null {
  const config = (project.processing_config || project.settings || {}) as Record<string, unknown>
  const templateId = config.template_id
  return typeof templateId === 'string' && templateId ? templateId : null
}

export function getTemplateLabel(templateId: string, fallbackName?: string): string {
  if (fallbackName) return fallbackName
  return TEMPLATE_LABELS[templateId] || templateId
}

export function loadPersistedSelectedTemplate<T>(): T | null {
  try {
    const raw = sessionStorage.getItem(SELECTED_TEMPLATE_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function persistSelectedTemplate<T>(template: T | null): void {
  if (!template) {
    sessionStorage.removeItem(SELECTED_TEMPLATE_STORAGE_KEY)
    return
  }
  sessionStorage.setItem(SELECTED_TEMPLATE_STORAGE_KEY, JSON.stringify(template))
}

export function clearPersistedSelectedTemplate(): void {
  sessionStorage.removeItem(SELECTED_TEMPLATE_STORAGE_KEY)
}
