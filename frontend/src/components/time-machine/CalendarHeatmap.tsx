// CalendarHeatmap.tsx
//
// GitHub-style contribution grid for the Time Machine query history page.
// Builds a 52×7 grid aligned to Sundays so each column is a full week.
// Cells are colored by snapshot activity: light = any snapshot, orange dot = change detected.
// Clicking a day filters the snapshot list below to that date.

import { Button } from '@/components/ui/button'

interface HeatmapProps {
  data: Record<string, { count: number; has_changes: boolean }>
  year: number
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
}

export default function CalendarHeatmap({ data, year, selectedDate, onSelectDate }: HeatmapProps) {
  // Build 52×7 grid starting from the first Sunday on or before Jan 1
  const jan1 = new Date(year, 0, 1)
  const startDay = new Date(jan1)
  startDay.setDate(jan1.getDate() - jan1.getDay()) // back to Sunday

  const weeks: Date[][] = []
  const current = new Date(startDay)
  while (current.getFullYear() <= year || (current.getFullYear() === year && current.getMonth() < 12)) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    weeks.push(week)
    if (current.getFullYear() > year) break
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  const getCellColor = (dateStr: string, inYear: boolean) => {
    if (!inYear) return 'bg-muted/20'
    const cell = data[dateStr]
    if (!cell || cell.count === 0) return 'bg-muted/40 hover:bg-muted/60'
    if (cell.has_changes) return 'bg-amber-500/80 hover:bg-amber-500'
    return 'bg-emerald-500/70 hover:bg-emerald-500'
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Activity — {year}</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-muted/40 inline-block" /> No data</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500/70 inline-block" /> Snapshot</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-500/80 inline-block" /> Changed</span>
          {selectedDate && (
            <Button variant="ghost" size="sm" className="h-5 px-2 text-xs" onClick={() => onSelectDate(null)}>
              Clear filter
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-1">
          {/* Day labels */}
          <div className="flex flex-col gap-[2px] mr-1">
            <div className="h-4" /> {/* spacer for month row */}
            {days.map((d, i) => (
              <div key={i} className="w-3 h-3 text-[9px] text-muted-foreground flex items-center justify-center">
                {i % 2 === 1 ? d : ''}
              </div>
            ))}
          </div>

          {weeks.map((week, wi) => {
            // Find if any day in this week starts a new month
            const monthLabel = week.find(d => d.getDate() === 1 && d.getFullYear() === year)
            return (
              <div key={wi} className="flex flex-col gap-[2px]">
                <div className="h-4 text-[9px] text-muted-foreground flex items-end pb-0.5">
                  {monthLabel ? months[monthLabel.getMonth()] : ''}
                </div>
                {week.map((day, di) => {
                  const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
                  const inYear = day.getFullYear() === year
                  const isSelected = selectedDate === dateStr
                  const cell = data[dateStr]
                  return (
                    <div
                      key={di}
                      title={inYear ? `${dateStr}: ${cell?.count ?? 0} snapshot(s)` : ''}
                      onClick={() => inYear && (cell?.count ?? 0) > 0 && onSelectDate(isSelected ? null : dateStr)}
                      className={[
                        'w-3 h-3 rounded-sm transition-colors',
                        getCellColor(dateStr, inYear),
                        inYear && (cell?.count ?? 0) > 0 ? 'cursor-pointer' : '',
                        isSelected ? 'ring-2 ring-primary ring-offset-1' : '',
                      ].join(' ')}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
