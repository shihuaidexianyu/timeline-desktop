/* ActivityWatch-inspired timeline with stacked lanes, navigator, and detail table. */

import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject, PointerEvent as ReactPointerEvent, WheelEvent } from 'react'
import {
  formatClockRange,
  formatDuration,
  type ChartSegment,
} from '../lib/chart-model'

type TimelineRow = {
  id: string
  label: string
  segments: ChartSegment[]
  selectedKey?: string | null
  splitByKey?: boolean
  includeInOverview?: boolean
  includeInTable?: boolean
}

type RowLayout = {
  id: string
  label: string
  selectedKey?: string | null
  lanes: ChartSegment[][]
  includeInOverview: boolean
  includeInTable: boolean
}

type OverviewSegment = {
  id: string
  leftPct: number
  widthPct: number
  topPct: number
  heightPct: number
  color: string
  opacity: number
}

type DragState = {
  mode: 'move' | 'resize-start' | 'resize-end'
  startClientX: number
  startSec: number
  endSec: number
}

const DAY_SECONDS = 24 * 60 * 60
const SNAP_SECONDS = 5 * 60

export function TimelineChart(props: {
  rows: TimelineRow[]
  viewStartSec: number
  viewEndSec: number
  baseDate?: string
  selectedSegmentId?: string | null
  interactiveZoom?: boolean
  showTable?: boolean
  minViewHours?: number
  maxViewHours?: number
  onViewportChange?: (startSec: number, endSec: number) => void
  onSelectSegment?: (segment: ChartSegment) => void
}) {
  const overviewRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const minZoomSec = Math.round((props.minViewHours ?? 1 / 12) * 3600)
  const maxZoomSec = Math.round((props.maxViewHours ?? 24) * 3600)
  const visibleDuration = props.viewEndSec - props.viewStartSec

  const layout = useMemo(() => buildRows(props.rows), [props.rows])
  const ticks = useMemo(
    () => buildTicks(props.viewStartSec, props.viewEndSec),
    [props.viewEndSec, props.viewStartSec],
  )
  const overviewSegments = useMemo(() => buildOverviewSegments(layout), [layout])
  const visibleItems = useMemo(
    () => buildVisibleItems(layout, props.viewStartSec, props.viewEndSec),
    [layout, props.viewEndSec, props.viewStartSec],
  )

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = dragStateRef.current
      const container = overviewRef.current

      if (!drag || !container || !props.onViewportChange) {
        return
      }

      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) {
        return
      }

      const deltaSec = ((event.clientX - drag.startClientX) / rect.width) * DAY_SECONDS

      if (drag.mode === 'move') {
        const next = clampWindow(drag.startSec + deltaSec, drag.endSec + deltaSec, visibleDuration)
        props.onViewportChange(next.startSec, next.endSec)
        return
      }

      if (drag.mode === 'resize-start') {
        const proposedStart = snapToStep(drag.startSec + deltaSec)
        const minStart = Math.max(0, drag.endSec - maxZoomSec)
        const maxStart = Math.max(0, drag.endSec - minZoomSec)
        props.onViewportChange(clampNumber(proposedStart, minStart, maxStart), drag.endSec)
        return
      }

      const proposedEnd = snapToStep(drag.endSec + deltaSec)
      const minEnd = Math.min(DAY_SECONDS, drag.startSec + minZoomSec)
      const maxEnd = Math.min(DAY_SECONDS, drag.startSec + maxZoomSec)
      props.onViewportChange(drag.startSec, clampNumber(proposedEnd, minEnd, maxEnd))
    }

    function handlePointerUp() {
      dragStateRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [maxZoomSec, minZoomSec, props, visibleDuration])

  if (layout.length === 0) {
    return <div className="empty-card">没有可展示的时间线数据</div>
  }

  return (
    <section className="timeline-devtools">
      <div className="timeline-devtools-head">
        <strong>
          {formatClock(props.viewStartSec)} - {formatClock(props.viewEndSec)}
        </strong>
        <span>滚轮滚动列表，Shift + 滚轮缩放，拖动底部窗口平移</span>
      </div>

      <div className="timeline-waterfall">
        <div className="timeline-axis">
          <div className="timeline-axis-label">名称</div>
          <div className="timeline-axis-track">
            {ticks.map((tick) => (
              <div
                key={`${tick.seconds}-${tick.label}`}
                className="timeline-axis-tick"
                style={{ left: `${tick.positionPct}%` }}
              >
                <span>{tick.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="timeline-waterfall-body"
          onWheel={(event) =>
            handleTimelineWheel(event, {
              minZoomSec,
              maxZoomSec,
              viewStartSec: props.viewStartSec,
              viewEndSec: props.viewEndSec,
              onViewportChange: props.onViewportChange,
            })
          }
        >
          {layout.map((row) => (
            <div key={row.id} className="timeline-row-block">
              <div className="timeline-row-head">
                <strong>{row.label}</strong>
                {row.lanes.length > 1 ? <span>{row.lanes.length} 层</span> : null}
              </div>

              <div className="timeline-row-lanes">
                {row.lanes.map((lane, laneIndex) => (
                  <div key={`${row.id}-lane-${laneIndex}`} className="timeline-lane">
                    {ticks.map((tick) => (
                      <span
                        key={`${row.id}-lane-${laneIndex}-${tick.seconds}`}
                        className="timeline-lane-grid"
                        style={{ left: `${tick.positionPct}%` }}
                      />
                    ))}

                    {lane.map((segment) => {
                      const clipped = clipSegment(segment, props.viewStartSec, props.viewEndSec)
                      if (!clipped) {
                        return null
                      }

                      const shouldDim =
                        row.selectedKey !== null &&
                        row.selectedKey !== undefined &&
                        row.selectedKey !== segment.key
                      const isSelected = props.selectedSegmentId === segment.id
                      const leftPct =
                        ((clipped.startSec - props.viewStartSec) / visibleDuration) * 100
                      const widthPct =
                        ((clipped.endSec - clipped.startSec) / visibleDuration) * 100

                      return (
                        <button
                          key={segment.id}
                          type="button"
                          className={`timeline-bar ${shouldDim ? 'is-dimmed' : ''} ${
                            isSelected ? 'is-selected' : ''
                          }`}
                          aria-label={buildTooltipText(segment)}
                          style={{
                            left: `${leftPct}%`,
                            width: `${Math.max(widthPct, 0.7)}%`,
                            backgroundColor: segment.color,
                          }}
                          title={buildTooltipText(segment)}
                          onClick={() => {
                            props.onSelectSegment?.(segment)
                          }}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {props.interactiveZoom ? (
        <div className="timeline-overview-panel">
          <div className="timeline-overview-head">
            <span>全天缩放</span>
            <span>{formatDuration(visibleDuration)}</span>
          </div>

          <div
            ref={overviewRef}
            className="timeline-overview"
            onPointerDown={(event) => {
              if (!props.onViewportChange) {
                return
              }

              const rect = overviewRef.current?.getBoundingClientRect()
              if (!rect) {
                return
              }

              const ratio = clampNumber((event.clientX - rect.left) / rect.width, 0, 1)
              const centerSec = ratio * DAY_SECONDS
              const next = clampWindow(
                centerSec - visibleDuration / 2,
                centerSec + visibleDuration / 2,
                visibleDuration,
              )
              props.onViewportChange(next.startSec, next.endSec)
            }}
          >
            <div className="timeline-overview-grid" />

            {overviewSegments.map((segment) => (
              <span
                key={segment.id}
                className="timeline-overview-segment"
                style={{
                  left: `${segment.leftPct}%`,
                  width: `${segment.widthPct}%`,
                  top: `${segment.topPct}%`,
                  height: `${segment.heightPct}%`,
                  backgroundColor: segment.color,
                  opacity: segment.opacity,
                }}
              />
            ))}

            <div
              className="timeline-overview-window"
              style={{
                left: `${(props.viewStartSec / DAY_SECONDS) * 100}%`,
                width: `${Math.max((visibleDuration / DAY_SECONDS) * 100, 1.6)}%`,
              }}
              onPointerDown={(event) => beginOverviewDrag(event, 'move', props, dragStateRef)}
            >
              <button
                type="button"
                className="timeline-overview-handle is-start"
                onPointerDown={(event) =>
                  beginOverviewDrag(event, 'resize-start', props, dragStateRef)
                }
              />
              <div className="timeline-overview-window-label">
                {formatClock(props.viewStartSec)} - {formatClock(props.viewEndSec)}
              </div>
              <button
                type="button"
                className="timeline-overview-handle is-end"
                onPointerDown={(event) =>
                  beginOverviewDrag(event, 'resize-end', props, dragStateRef)
                }
              />
            </div>
          </div>
        </div>
      ) : null}

      {props.showTable ? (
        <div className="timeline-table">
          <div className="timeline-table-header">
            <span>名称</span>
            <span>类型</span>
            <span>说明</span>
            <span>时间段</span>
            <span>时长</span>
          </div>

          <div className="timeline-table-body">
            {visibleItems.map((item) => (
              <button
                key={`${item.id}-row`}
                type="button"
                className={`timeline-table-row ${item.id === props.selectedSegmentId ? 'is-selected' : ''}`}
                onClick={() => {
                  props.onSelectSegment?.(item)
                }}
              >
                <span className="timeline-table-name">
                  <i style={{ backgroundColor: item.color }} />
                  {item.label}
                </span>
                <span>{segmentTypeLabel(item)}</span>
                <span className="timeline-table-detail">{item.detail}</span>
                <span>{formatClockRange(item.startSec, item.endSec)}</span>
                <span>{formatDuration(item.durationSec)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function buildRows(rows: TimelineRow[]): RowLayout[] {
  return rows.flatMap((row) => {
    const shouldSplitByKey =
      row.splitByKey ??
      (row.segments.length > 0 &&
        (row.segments[0].tone === 'focus' || row.segments[0].tone === 'browser'))
    const includeInOverview = row.includeInOverview ?? true
    const includeInTable = row.includeInTable ?? true

    if (!shouldSplitByKey) {
      return [
        {
          id: row.id,
          label: row.label,
          selectedKey: row.selectedKey,
          lanes: buildLanes(row.segments),
          includeInOverview,
          includeInTable,
        },
      ]
    }

    const grouped = new Map<string, { label: string; segments: ChartSegment[]; total: number }>()

    for (const segment of row.segments) {
      const current = grouped.get(segment.key)
      if (current) {
        current.segments.push(segment)
        current.total += segment.durationSec
        continue
      }

      grouped.set(segment.key, {
        label: segment.label,
        segments: [segment],
        total: segment.durationSec,
      })
    }

    return Array.from(grouped.entries())
      .sort((left, right) => right[1].total - left[1].total)
      .map(([key, group]) => ({
        id: `${row.id}-${key}`,
        label: group.label,
        selectedKey: row.selectedKey,
        lanes: buildLanes(group.segments),
        includeInOverview,
        includeInTable,
      }))
  })
}

function buildLanes(segments: ChartSegment[]) {
  const lanes: ChartSegment[][] = []
  const ordered = [...segments].sort((left, right) => {
    if (left.startSec !== right.startSec) {
      return left.startSec - right.startSec
    }

    return left.endSec - right.endSec
  })

  for (const segment of ordered) {
    let placed = false

    for (const lane of lanes) {
      const last = lane[lane.length - 1]
      if (last.endSec <= segment.startSec) {
        lane.push(segment)
        placed = true
        break
      }
    }

    if (!placed) {
      lanes.push([segment])
    }
  }

  return lanes.length > 0 ? lanes : [[]]
}

function buildTicks(viewStartSec: number, viewEndSec: number) {
  const duration = viewEndSec - viewStartSec
  const step = chooseTickStep(duration)
  const first = Math.floor(viewStartSec / step) * step
  const ticks: Array<{ seconds: number; label: string; positionPct: number }> = []

  for (let value = first; value <= viewEndSec; value += step) {
    const seconds = clampNumber(value, viewStartSec, viewEndSec)
    ticks.push({
      seconds,
      label: formatTickLabel(seconds, duration),
      positionPct: ((seconds - viewStartSec) / duration) * 100,
    })
  }

  return ticks
}

function buildOverviewSegments(rows: RowLayout[]): OverviewSegment[] {
  const overviewRows = rows.filter((row) => row.includeInOverview)
  const totalRows = Math.max(overviewRows.length, 1)

  return overviewRows.flatMap((row, rowIndex) =>
    row.lanes.flatMap((lane, laneIndex) =>
      lane.map((segment) => ({
        id: `${segment.id}-overview`,
        leftPct: (segment.startSec / DAY_SECONDS) * 100,
        widthPct: Math.max((segment.durationSec / DAY_SECONDS) * 100, 0.2),
        topPct: ((rowIndex + laneIndex / Math.max(row.lanes.length, 1)) / totalRows) * 100 + 6,
        heightPct: 18 / totalRows,
        color: segment.color,
        opacity: 0.82,
      })),
    ),
  )
}

function buildVisibleItems(rows: RowLayout[], viewStartSec: number, viewEndSec: number) {
  return rows
    .filter((row) => row.includeInTable)
    .flatMap((row) => row.lanes.flatMap((lane) => lane))
    .filter((segment) => segment.endSec > viewStartSec && segment.startSec < viewEndSec)
    .sort((left, right) => {
      if (left.startSec !== right.startSec) {
        return left.startSec - right.startSec
      }

      return right.durationSec - left.durationSec
    })
}

function clipSegment(segment: ChartSegment, viewStartSec: number, viewEndSec: number) {
  const startSec = Math.max(segment.startSec, viewStartSec)
  const endSec = Math.min(segment.endSec, viewEndSec)

  if (endSec <= startSec) {
    return null
  }

  return {
    startSec,
    endSec,
  }
}

function beginOverviewDrag(
  event: ReactPointerEvent<HTMLElement>,
  mode: DragState['mode'],
  props: {
    viewStartSec: number
    viewEndSec: number
  },
  dragStateRef: MutableRefObject<DragState | null>,
) {
  event.preventDefault()
  event.stopPropagation()
  dragStateRef.current = {
    mode,
    startClientX: event.clientX,
    startSec: props.viewStartSec,
    endSec: props.viewEndSec,
  }
}

function handleTimelineWheel(
  event: WheelEvent<HTMLDivElement>,
  options: {
    minZoomSec: number
    maxZoomSec: number
    viewStartSec: number
    viewEndSec: number
    onViewportChange?: (startSec: number, endSec: number) => void
  },
) {
  const shouldZoom = event.shiftKey || event.ctrlKey || event.metaKey

  if (!shouldZoom || !options.onViewportChange) {
    return
  }

  event.preventDefault()
  const rect = event.currentTarget.getBoundingClientRect()
  const ratio = clampNumber((event.clientX - rect.left) / rect.width, 0, 1)
  const currentDuration = options.viewEndSec - options.viewStartSec
  const factor = event.deltaY > 0 ? 1.14 : 0.86
  const nextDuration = clampNumber(
    snapToStep(currentDuration * factor),
    options.minZoomSec,
    options.maxZoomSec,
  )
  const anchorSec = options.viewStartSec + ratio * currentDuration
  const nextStart = anchorSec - ratio * nextDuration
  const next = clampWindow(nextStart, nextStart + nextDuration, nextDuration)
  options.onViewportChange(next.startSec, next.endSec)
}

function clampWindow(startSec: number, endSec: number, duration: number) {
  let nextStart = startSec
  let nextEnd = endSec

  if (nextStart < 0) {
    nextStart = 0
    nextEnd = duration
  }

  if (nextEnd > DAY_SECONDS) {
    nextEnd = DAY_SECONDS
    nextStart = DAY_SECONDS - duration
  }

  return {
    startSec: snapToStep(nextStart),
    endSec: snapToStep(nextEnd),
  }
}

function chooseTickStep(duration: number) {
  if (duration <= 15 * 60) {
    return 60
  }
  if (duration <= 60 * 60) {
    return 5 * 60
  }
  if (duration <= 2 * 60 * 60) {
    return 15 * 60
  }
  if (duration <= 8 * 60 * 60) {
    return 60 * 60
  }
  return 2 * 60 * 60
}

function formatTickLabel(seconds: number, duration: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (duration <= 15 * 60) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
  }

  return `${pad(hours)}:${pad(minutes)}`
}

function formatClock(seconds: number) {
  const clamped = clampNumber(seconds, 0, DAY_SECONDS)
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  return `${pad(hours)}:${pad(minutes)}`
}

function pad(value: number) {
  return `${value}`.padStart(2, '0')
}

function snapToStep(seconds: number) {
  return Math.round(seconds / SNAP_SECONDS) * SNAP_SECONDS
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function buildTooltipText(segment: ChartSegment) {
  return [
    segment.label,
    segment.detail,
    formatClockRange(segment.startSec, segment.endSec),
    formatDuration(segment.durationSec),
  ].join('\n')
}

function segmentTypeLabel(segment: ChartSegment) {
  if (segment.tone === 'presence') {
    return '状态'
  }

  if (segment.tone === 'browser') {
    return '域名'
  }

  return segment.isBrowser ? '浏览器' : '应用'
}
