/** Reads a CSS custom property value from the root element. */
export function getCssVariable(name: string): string {
  if (typeof window === 'undefined') {
    return ''
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value
}

/** Returns hex/rgba color string for ECharts that matches current theme. */
export function getThemeColor(name: string, fallback: string): string {
  const value = getCssVariable(name)
  return value || fallback
}

/** ECharts tooltip colors derived from CSS variables. */
export function getEChartsTooltipColors() {
  return {
    backgroundColor: getThemeColor('--panel-bg-solid', '#ffffff'),
    borderColor: getThemeColor('--panel-border', 'rgba(146, 166, 191, 0.24)'),
    textColor: getThemeColor('--text-main', '#1f2a37'),
  }
}

/** ECharts pie item border color derived from CSS variables. */
export function getEChartsPieBorderColor() {
  return getThemeColor('--panel-bg-solid', '#ffffff')
}

/** Detects whether dark mode is currently active. */
export function isDarkModeActive(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return document.documentElement.getAttribute('data-theme') === 'dark'
}
