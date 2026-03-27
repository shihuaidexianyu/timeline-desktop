/* Donut chart rendered with ECharts so tooltip, legend, and selection share one engine. */

import { useMemo } from 'react'
import ReactEChartsCoreImport from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { GraphicComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import {
  formatDuration,
  isFilterActive,
  type DashboardFilter,
  type DonutSlice,
} from '../lib/chart-model'

echarts.use([PieChart, TooltipComponent, GraphicComponent, SVGRenderer])

const ReactEChartsCore = (
  typeof ReactEChartsCoreImport === 'object' &&
    ReactEChartsCoreImport !== null &&
    'default' in ReactEChartsCoreImport
    ? (ReactEChartsCoreImport as { default: unknown }).default
    : ReactEChartsCoreImport
) as React.ComponentType<Record<string, unknown>>

const LABEL_COLOR = '#1d2c43'
const MUTED_COLOR = '#6f839f'
const MONO_FAMILY = '"JetBrains Mono", "Cascadia Mono", "Consolas", "SFMono-Regular", monospace'
const PIE_CENTER_X = '50%'

export function DonutChart(props: {
  loading?: boolean
  title: string
  totalLabel: string
  slices: DonutSlice[]
  filter: DashboardFilter
  filterKind: 'app' | 'domain'
  onSelect: (filter: DashboardFilter) => void
}) {
  /** Show at most 5 slices in the legend; group the rest as "Others". */
  const isLoading = Boolean(props.loading)
  const displaySlices = useMemo(() => collapseSlices(props.slices, 5), [props.slices])
  const placeholderSlices = useMemo(() => createPlaceholderSlices(5), [])
  const rankingSlices = useMemo(
    () => props.slices.filter((slice) => slice.key !== 'others').slice(0, 5),
    [props.slices],
  )
  const chartSlices = isLoading ? placeholderSlices : displaySlices
  const rankingRows = isLoading ? placeholderSlices : rankingSlices

  const option = useMemo<EChartsOption>(() => {
    return {
      animation: !isLoading,
      animationDuration: 180,
      animationDurationUpdate: 180,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicOut',
      tooltip: {
        show: !isLoading,
        trigger: 'item',
        appendToBody: true,
        transitionDuration: 0.08,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        borderColor: 'rgba(145, 159, 180, 0.28)',
        borderWidth: 1,
        textStyle: {
          color: LABEL_COLOR,
          fontFamily: MONO_FAMILY,
        },
        formatter: (params) => {
          const slice = getSliceDatum(params)
          if (!slice) {
            return ''
          }

          return [
            `<div style="min-width:180px">`,
            `<div style="font-weight:600;margin-bottom:6px">${escapeHtml(slice.label)}</div>`,
            `<div>${escapeHtml(formatDuration(slice.value))}</div>`,
            `<div>${slice.percentage.toFixed(1)}%</div>`,
            `</div>`,
          ].join('')
        },
      },
      series: [
        {
          name: props.title,
          type: 'pie',
          radius: ['56%', '76%'],
          center: [PIE_CENTER_X, '50%'],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: {
            borderColor: '#f7faff',
            borderWidth: 1,
          },
          emphasis: {
            scale: true,
            scaleSize: 10,
            itemStyle: {
              shadowBlur: 14,
              shadowColor: 'rgba(28, 50, 86, 0.2)',
            },
          },
          data: chartSlices.map((slice) => {
            const isActive = isFilterActive(props.filter, props.filterKind, slice.key)
            const shouldDim =
              !isLoading &&
              props.filter?.kind === props.filterKind &&
              !isActive &&
              props.filter.key !== slice.key

            return {
              value: slice.value,
              name: slice.label,
              raw: slice,
              selected: isActive,
              selectedOffset: 8,
              itemStyle: {
                color: slice.color,
                opacity: shouldDim ? 0.24 : 0.96,
              },
            }
          }),
        },
      ],
      graphic: [
        {
          type: 'text',
          left: PIE_CENTER_X,
          top: '41%',
          style: {
            text: isLoading ? '' : props.totalLabel,
            fill: LABEL_COLOR,
            font: `700 20px ${MONO_FAMILY}`,
            textAlign: 'center',
          },
        },
        {
          type: 'text',
          left: PIE_CENTER_X,
          top: '52%',
          style: {
            text: isLoading ? '' : '总计时长',
            fill: MUTED_COLOR,
            font: `12px ${MONO_FAMILY}`,
            textAlign: 'center',
          },
        },
      ],
    }
  }, [
    chartSlices,
    isLoading,
    props.filter,
    props.filterKind,
    props.title,
    props.totalLabel,
  ])

  if (!isLoading && displaySlices.length === 0) {
    return <div className="empty-card">没有可展示的数据</div>
  }

  return (
    <div className="donut-card" data-loading={isLoading ? 'true' : 'false'}>
      <div className="donut-visual-shell">
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          notMerge
          lazyUpdate
          opts={{ renderer: 'svg' }}
          onEvents={
            isLoading
              ? undefined
              : {
                click: (params: unknown) => {
                  const slice = getSliceDatum(params)
                  if (!slice || slice.key === 'others') {
                    return
                  }

                  const isActive = isFilterActive(props.filter, props.filterKind, slice.key)
                  props.onSelect(isActive ? null : { kind: props.filterKind, key: slice.key })
                },
              }
          }
          style={{ height: 288, width: '100%', paddingInline: 14 }}
        />

        {isLoading ? (
          <div className="skeleton-overlay donut-visual-overlay" aria-hidden="true">
            <span className="skeleton-block donut-ring-skeleton" />
            <span className="skeleton-block skeleton-inline donut-total-skeleton donut-total-skeleton-main" />
            <span className="skeleton-block skeleton-inline donut-caption-skeleton donut-caption-skeleton-main" />
          </div>
        ) : null}
      </div>

      <div className="ranking-list">
        {rankingRows.map((slice) => {
          const isActive = isFilterActive(props.filter, props.filterKind, slice.key)

          return (
            <button
              key={`ranking-${slice.id}`}
              type="button"
              className="ranking-row"
              disabled={isLoading}
              aria-hidden={isLoading}
              onClick={() => props.onSelect(isActive ? null : { kind: props.filterKind, key: slice.key })}
            >
              {isLoading ? (
                <>
                  <span className="skeleton-block skeleton-inline skeleton-ranking-name" />
                  <span className="skeleton-block skeleton-inline skeleton-ranking-value" />
                  <span className="skeleton-block skeleton-inline skeleton-ranking-percent" />
                </>
              ) : (
                <>
                  <span className="ranking-name">
                    <i style={{ backgroundColor: slice.color }} />
                    {slice.label}
                  </span>
                  <span>{formatDuration(slice.value)}</span>
                  <span>{slice.percentage.toFixed(1)}%</span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function CompactDonutChart(props: {
  loading?: boolean
  slices: DonutSlice[]
  totalLabel: string
  secondaryLabel: string
  footerLabel?: string
  selectedKey?: string | null
  onSelectKey?: (key: string) => void
  emptyLabel?: string
  height?: number
}) {
  const isLoading = Boolean(props.loading)
  const displaySlices = useMemo(
    () => props.slices.filter((slice) => slice.value > 0),
    [props.slices],
  )
  const placeholderSlices = useMemo(() => createPlaceholderSlices(3), [])
  const chartSlices = isLoading ? placeholderSlices : displaySlices
  const emphasizedSlice = useMemo(() => {
    if (chartSlices.length === 0) {
      return null
    }

    if (!isLoading && props.selectedKey) {
      const selected = chartSlices.find((slice) => slice.key === props.selectedKey)
      if (selected) {
        return selected
      }
    }

    return chartSlices[0]
  }, [chartSlices, isLoading, props.selectedKey])

  const option = useMemo<EChartsOption>(() => {
    return {
      animation: !isLoading,
      animationDuration: 180,
      animationDurationUpdate: 180,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicOut',
      tooltip: {
        show: !isLoading,
        trigger: 'item',
        appendToBody: true,
        transitionDuration: 0.08,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        borderColor: 'rgba(145, 159, 180, 0.28)',
        borderWidth: 1,
        textStyle: {
          color: LABEL_COLOR,
          fontFamily: MONO_FAMILY,
        },
        formatter: (params) => {
          const slice = getSliceDatum(params)
          if (!slice) {
            return ''
          }

          return [
            `<div style="min-width:180px">`,
            `<div style="font-weight:600;margin-bottom:6px">${escapeHtml(slice.label)}</div>`,
            `<div>${escapeHtml(formatDuration(slice.value))}</div>`,
            `<div>${slice.percentage.toFixed(1)}%</div>`,
            `</div>`,
          ].join('')
        },
      },
      series: [
        {
          name: '状态分布',
          type: 'pie',
          radius: ['56%', '76%'],
          center: [PIE_CENTER_X, '50%'],
          selectedMode: false,
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: {
            borderColor: '#f7faff',
            borderWidth: 1,
          },
          emphasis: {
            scale: true,
            scaleSize: 10,
            itemStyle: {
              shadowBlur: 14,
              shadowColor: 'rgba(28, 50, 86, 0.2)',
            },
          },
          data: chartSlices.map((slice) => {
            const isActive = props.selectedKey === slice.key
            const shouldDim =
              !isLoading && props.selectedKey !== null && props.selectedKey !== undefined && !isActive

            return {
              value: slice.value,
              name: slice.label,
              raw: slice,
              itemStyle: {
                color: slice.color,
                opacity: shouldDim ? 0.24 : 0.96,
                cursor: props.onSelectKey ? 'pointer' : 'default',
              },
            }
          }),
        },
      ],
      graphic: [
        {
          type: 'text',
          silent: true,
          left: 'center',
          top: props.footerLabel ? '38%' : '41%',
          style: {
            text: isLoading ? '' : props.totalLabel,
            fill: LABEL_COLOR,
            font: `700 20px ${MONO_FAMILY}`,
            textAlign: 'center',
          },
        },
        {
          type: 'text',
          silent: true,
          left: 'center',
          top: props.footerLabel ? '49%' : '53%',
          style: {
            text: isLoading ? '' : props.secondaryLabel,
            fill: emphasizedSlice?.color ?? MUTED_COLOR,
            font: `600 12px ${MONO_FAMILY}`,
            textAlign: 'center',
          },
        },
        ...(props.footerLabel
          ? [
            {
              type: 'text' as const,
              silent: true,
              left: 'center',
              top: '61%',
              style: {
                text: isLoading ? '' : props.footerLabel,
                fill: MUTED_COLOR,
                font: `11px ${MONO_FAMILY}`,
                textAlign: 'center',
              },
            },
          ]
          : []),
      ],
    }
  }, [
    chartSlices,
    props.footerLabel,
    emphasizedSlice,
    isLoading,
    props.onSelectKey,
    props.secondaryLabel,
    props.selectedKey,
    props.totalLabel,
  ])

  if (!isLoading && displaySlices.length === 0) {
    return (
      <div
        className="empty-card compact-donut-empty"
        style={{ minHeight: props.height ?? 220 }}
      >
        {props.emptyLabel ?? '没有可展示的数据'}
      </div>
    )
  }

  return (
    <div className="compact-donut-shell" data-loading={isLoading ? 'true' : 'false'}>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        notMerge
        lazyUpdate
        opts={{ renderer: 'svg' }}
        onEvents={
          !isLoading && props.onSelectKey
            ? {
              click: (params: unknown) => {
                const slice = getSliceDatum(params)
                if (!slice) {
                  return
                }

                props.onSelectKey?.(slice.key)
              },
            }
            : undefined
        }
        style={{ height: props.height ?? 220, width: '100%' }}
      />

      {isLoading ? (
        <div className="skeleton-overlay compact-donut-overlay" aria-hidden="true">
          <span className="skeleton-block donut-ring-skeleton donut-ring-skeleton-compact" />
          <span className="skeleton-block skeleton-inline donut-total-skeleton donut-total-skeleton-compact" />
          <span className="skeleton-block skeleton-inline donut-caption-skeleton donut-caption-skeleton-compact" />
          <span className="skeleton-block skeleton-inline donut-footer-skeleton" />
        </div>
      ) : null}
    </div>
  )
}

function getSliceDatum(params: unknown) {
  if (!params || typeof params !== 'object' || !('data' in params)) {
    return null
  }

  const data = (params as { data?: { raw?: unknown } }).data
  if (!data?.raw || typeof data.raw !== 'object') {
    return null
  }

  return data.raw as DonutSlice
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function collapseSlices(slices: DonutSlice[], keepTopN: number) {
  if (slices.length <= keepTopN) {
    return slices
  }

  const primary = slices.filter((slice) => slice.key !== 'others').slice(0, keepTopN)
  const remainder = slices.filter(
    (slice) => slice.key === 'others' || !primary.some((item) => item.key === slice.key),
  )

  if (remainder.length === 0) {
    return primary
  }

  const otherValue = remainder.reduce((sum, slice) => sum + slice.value, 0)
  const totalValue = primary.reduce((sum, slice) => sum + slice.value, 0) + otherValue

  return [
    ...primary,
    {
      id: 'slice-others-collapsed',
      key: 'others',
      label: '其他',
      value: otherValue,
      percentage: totalValue === 0 ? 0 : (otherValue / totalValue) * 100,
      color: '#94a3b8',
    },
  ]
}

function createPlaceholderSlices(count: number): DonutSlice[] {
  const palette = ['#dbe4f1', '#d1dbe9', '#c8d4e5', '#d7e0ed', '#ccd7e8']
  const normalizedCount = Math.max(count, 1)

  return Array.from({ length: normalizedCount }, (_, index) => ({
    id: `placeholder-${index}`,
    key: `placeholder-${index}`,
    label: '加载中',
    value: 1,
    percentage: 100 / normalizedCount,
    color: palette[index % palette.length],
  }))
}
