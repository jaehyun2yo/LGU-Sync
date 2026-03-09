import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '../lib/utils'
import type { SortOrder } from '../hooks/useSort'

export function SortableHeader<K extends string>({
  field,
  label,
  currentField,
  currentOrder,
  onSort,
  className,
}: {
  field: K
  label: string
  currentField: K
  currentOrder: SortOrder
  onSort: (field: K) => void
  className?: string
}) {
  const isActive = currentField === field
  const Icon = isActive ? (currentOrder === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1 hover:text-foreground transition-colors',
        className,
      )}
      onClick={() => onSort(field)}
    >
      {label}
      <Icon className={cn('h-3 w-3', isActive && 'text-foreground')} />
    </button>
  )
}
