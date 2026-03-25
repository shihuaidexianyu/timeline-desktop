import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ChartSegment } from '../lib/chart-model'
import { formatDuration } from '../lib/chart-model'

const DAY_SECONDS = 24 * 60 * 60
const SNAP_SECONDS = 5 * 60
const CLOCK_SIZE = 292
const CLOCK_CENTER = CLOCK_SIZE / 2
const OUTER_RING_RADIUS = 116
const INNER_RING_RADIUS = 100
const WINDOW_RING_RADIUS = 84

type DragMode = 'start' | 'end' | null

export function TimelineClock(props: {
    focusSegments: ChartSegment[]
    presenceSegments: ChartSegment[]
    viewStartSec: number
    viewEndSec: number
    minViewSec: number
    maxViewSec: number
    onWindowChange: (startSec: number, endSec: number) => void
}) {
    const svgRef = useRef<SVGSVGElement | null>(null)
    const dragModeRef = useRef<DragMode>(null)
    const [isDragging, setIsDragging] = useState(false)

    const focusArcs = useMemo(
        () => toArcs(props.focusSegments, OUTER_RING_RADIUS, 9),
        [props.focusSegments],
    )
    const presenceArcs = useMemo(
        () => toArcs(props.presenceSegments, INNER_RING_RADIUS, 7),
        [props.presenceSegments],
    )

    const windowDuration = Math.max(0, props.viewEndSec - props.viewStartSec)
    const startPoint = pointAtSec(props.viewStartSec, WINDOW_RING_RADIUS)
    const endPoint = pointAtSec(props.viewEndSec, WINDOW_RING_RADIUS)

    useEffect(() => {
        function handlePointerMove(event: PointerEvent) {
            const mode = dragModeRef.current
            const svg = svgRef.current
            if (!mode || !svg) {
                return
            }

            const nextSec = snapToStep(secFromPointer(event.clientX, event.clientY, svg))
            const start = props.viewStartSec
            const end = props.viewEndSec

            if (mode === 'start') {
                const minStart = Math.max(0, end - props.maxViewSec)
                const maxStart = Math.max(0, end - props.minViewSec)
                props.onWindowChange(clamp(nextSec, minStart, maxStart), end)
                return
            }

            const minEnd = Math.min(DAY_SECONDS, start + props.minViewSec)
            const maxEnd = Math.min(DAY_SECONDS, start + props.maxViewSec)
            props.onWindowChange(start, clamp(nextSec, minEnd, maxEnd))
        }

        function handlePointerUp() {
            dragModeRef.current = null
            setIsDragging(false)
        }

        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
        window.addEventListener('pointercancel', handlePointerUp)

        return () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
            window.removeEventListener('pointercancel', handlePointerUp)
        }
    }, [
        props,
        props.maxViewSec,
        props.minViewSec,
        props.onWindowChange,
        props.viewEndSec,
        props.viewStartSec,
    ])

    function beginHandleDrag(event: ReactPointerEvent<SVGCircleElement>, mode: DragMode) {
        event.preventDefault()
        event.stopPropagation()
        dragModeRef.current = mode
        setIsDragging(true)
    }

    function jumpToPointer(event: ReactPointerEvent<SVGSVGElement>) {
        if (dragModeRef.current !== null) {
            return
        }

        const svg = svgRef.current
        if (!svg) {
            return
        }

        const centerSec = snapToStep(secFromPointer(event.clientX, event.clientY, svg))
        const half = windowDuration / 2
        const nextStart = clamp(centerSec - half, 0, DAY_SECONDS - windowDuration)
        props.onWindowChange(nextStart, nextStart + windowDuration)
    }

    return (
        <div className={`timeline-clock-card ${isDragging ? 'is-dragging' : ''}`}>
            <div className="timeline-clock-shell">
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${CLOCK_SIZE} ${CLOCK_SIZE}`}
                    className="timeline-clock-svg"
                    onPointerDown={jumpToPointer}
                >
                    <circle cx={CLOCK_CENTER} cy={CLOCK_CENTER} r={124} className="timeline-clock-base" />

                    {buildHourTicks().map((tick) => (
                        <line
                            key={`tick-${tick.hour}`}
                            x1={tick.x1}
                            y1={tick.y1}
                            x2={tick.x2}
                            y2={tick.y2}
                            className={`timeline-clock-tick ${tick.major ? 'is-major' : ''}`}
                        />
                    ))}

                    {focusArcs.map((arc) => (
                        <path
                            key={`focus-${arc.id}`}
                            d={arc.path}
                            stroke={arc.color}
                            strokeWidth={arc.strokeWidth}
                            className="timeline-clock-arc focus"
                        />
                    ))}

                    {presenceArcs.map((arc) => (
                        <path
                            key={`presence-${arc.id}`}
                            d={arc.path}
                            stroke={arc.color}
                            strokeWidth={arc.strokeWidth}
                            className="timeline-clock-arc presence"
                        />
                    ))}

                    <path
                        d={arcPath(props.viewStartSec, props.viewEndSec, WINDOW_RING_RADIUS)}
                        className="timeline-clock-window-arc"
                    />

                    <circle
                        cx={startPoint.x}
                        cy={startPoint.y}
                        r={6}
                        className="timeline-clock-handle"
                        onPointerDown={(event) => beginHandleDrag(event, 'start')}
                    />
                    <circle
                        cx={endPoint.x}
                        cy={endPoint.y}
                        r={6}
                        className="timeline-clock-handle"
                        onPointerDown={(event) => beginHandleDrag(event, 'end')}
                    />

                    {buildHourLabels().map((label) => (
                        <text
                            key={`label-${label.hour}`}
                            x={label.x}
                            y={label.y}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="timeline-clock-hour-label"
                        >
                            {label.text}
                        </text>
                    ))}
                </svg>

                <div className="timeline-clock-center">
                    <strong>{formatClock(props.viewStartSec)} - {formatClock(props.viewEndSec)}</strong>
                    <small>{formatDuration(windowDuration)}</small>
                </div>
            </div>
        </div>
    )
}

type ArcDatum = {
    id: string
    path: string
    color: string
    strokeWidth: number
}

function toArcs(segments: ChartSegment[], radius: number, strokeWidth: number): ArcDatum[] {
    return segments
        .filter((segment) => segment.endSec > segment.startSec)
        .map((segment) => ({
            id: segment.id,
            path: arcPath(segment.startSec, segment.endSec, radius),
            color: segment.color,
            strokeWidth,
        }))
}

function buildHourTicks() {
    return Array.from({ length: 24 }, (_, hour) => {
        const sec = hour * 3600
        const outer = pointAtSec(sec, 128)
        const inner = pointAtSec(sec, hour % 3 === 0 ? 118 : 122)
        return {
            hour,
            x1: outer.x,
            y1: outer.y,
            x2: inner.x,
            y2: inner.y,
            major: hour % 3 === 0,
        }
    })
}

function buildHourLabels() {
    return [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => {
        const point = pointAtSec(hour * 3600, 137)
        return {
            hour,
            text: `${String(hour).padStart(2, '0')}`,
            x: point.x,
            y: point.y,
        }
    })
}

function arcPath(startSec: number, endSec: number, radius: number) {
    const safeStart = clamp(startSec, 0, DAY_SECONDS)
    const safeEnd = clamp(endSec, 0, DAY_SECONDS)
    const duration = Math.max(0, safeEnd - safeStart)

    if (duration <= 0) {
        return ''
    }

    const start = pointAtSec(safeStart, radius)
    const end = pointAtSec(safeEnd, radius)
    const largeArc = duration > DAY_SECONDS / 2 ? 1 : 0

    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

function pointAtSec(seconds: number, radius: number) {
    const angle = secToAngle(seconds)
    return {
        x: CLOCK_CENTER + radius * Math.cos(angle),
        y: CLOCK_CENTER + radius * Math.sin(angle),
    }
}

function secToAngle(seconds: number) {
    const ratio = clamp(seconds, 0, DAY_SECONDS) / DAY_SECONDS
    return ratio * Math.PI * 2 - Math.PI / 2
}

function secFromPointer(clientX: number, clientY: number, svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect()
    const x = clientX - rect.left - rect.width / 2
    const y = clientY - rect.top - rect.height / 2
    const angle = Math.atan2(y, x) + Math.PI / 2
    const normalized = angle < 0 ? angle + Math.PI * 2 : angle
    return (normalized / (Math.PI * 2)) * DAY_SECONDS
}

function formatClock(seconds: number) {
    const clamped = clamp(seconds, 0, DAY_SECONDS)
    const hours = Math.floor(clamped / 3600)
    const minutes = Math.floor((clamped % 3600) / 60)
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function snapToStep(seconds: number) {
    return Math.round(seconds / SNAP_SECONDS) * SNAP_SECONDS
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(value, max))
}
