import { useState, useMemo, useCallback } from 'react'

export type SortOrder = 'asc' | 'desc'

export function useSort<T, K extends string>(
  data: T[],
  defaultField: K,
  defaultOrder: SortOrder,
  comparators: Record<K, (a: T, b: T) => number>,
) {
  const [sortField, setSortField] = useState<K>(defaultField)
  const [sortOrder, setSortOrder] = useState<SortOrder>(defaultOrder)

  const handleSortChange = useCallback(
    (field: K) => {
      if (sortField === field) {
        setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortField(field)
        setSortOrder('asc')
      }
    },
    [sortField],
  )

  const sorted = useMemo(() => {
    const compare = comparators[sortField]
    if (!compare) return data
    const multiplier = sortOrder === 'asc' ? 1 : -1
    return [...data].sort((a, b) => compare(a, b) * multiplier)
  }, [data, sortField, sortOrder, comparators])

  return { sorted, sortField, sortOrder, handleSortChange }
}
