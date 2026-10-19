import { createContext, useContext, useMemo } from 'react'

import { useDocuments } from '../api/queries'
import { assignSourceColors } from './sourceColors'

/**
 * Each source's hue (1-8) in a notebook. Sources are assigned oldest first, so a
 * source keeps its color when others are added or removed later.
 */
export function useSourceColors(notebookId: string): Map<string, number> {
  const documents = useDocuments(notebookId)
  return useMemo(() => {
    const ordered = [...(documents.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))
    return assignSourceColors(ordered.map((d) => d.id))
  }, [documents.data])
}

/** The open notebook's source colors, provided by the workspace for chips, cards and highlights. */
export const SourceColorsContext = createContext<Map<string, number>>(new Map())

/** Hue of one source; 1 when unknown (e.g. a removed source). */
export function useSourceColor(documentId: string | undefined): number {
  const colors = useContext(SourceColorsContext)
  return (documentId && colors.get(documentId)) || 1
}
