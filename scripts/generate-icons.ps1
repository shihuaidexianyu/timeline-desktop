param()

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

function Get-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function New-ClockBitmap {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Size
    )

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.Clear([System.Drawing.Color]::Transparent)

        $padding = [double]::Max(1.0, $Size * 0.08)
        $diameter = $Size - (2.0 * $padding)
        $x = [float]$padding
        $y = [float]$padding
        $w = [float]$diameter
        $h = [float]$diameter

        $dialBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
        $ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 28, 36, 46), [float][double]::Max(1.5, $Size * 0.085))
        $minutePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 20, 28, 38), [float][double]::Max(1.2, $Size * 0.095))
        $hourPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 20, 28, 38), [float][double]::Max(1.1, $Size * 0.11))
        $tickPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 20, 28, 38), [float][double]::Max(1.0, $Size * 0.07))
        try {
            $minutePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $minutePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $hourPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $hourPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $tickPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $tickPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

            $graphics.FillEllipse($dialBrush, $x, $y, $w, $h)
            $graphics.DrawEllipse($ringPen, $x, $y, $w, $h)

            $cx = $Size / 2.0
            $cy = $Size / 2.0
            $radius = $diameter / 2.0

            $tickOuter = $cy - ($radius * 0.82)
            $tickInner = $cy - ($radius * 0.62)
            $graphics.DrawLine($tickPen, [float]$cx, [float]$tickOuter, [float]$cx, [float]$tickInner)

            $minuteAngle = [Math]::PI * (20.0 / 180.0)
            $minuteLen = $radius * 0.72
            $minuteX = $cx + ([Math]::Sin($minuteAngle) * $minuteLen)
            $minuteY = $cy - ([Math]::Cos($minuteAngle) * $minuteLen)
            $graphics.DrawLine($minutePen, [float]$cx, [float]$cy, [float]$minuteX, [float]$minuteY)

            $hourAngle = [Math]::PI * (-52.0 / 180.0)
            $hourLen = $radius * 0.5
            $hourX = $cx + ([Math]::Sin($hourAngle) * $hourLen)
            $hourY = $cy - ([Math]::Cos($hourAngle) * $hourLen)
            $graphics.DrawLine($hourPen, [float]$cx, [float]$cy, [float]$hourX, [float]$hourY)

            $hubRadius = [float][double]::Max(1.3, $Size * 0.06)
            $hubBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 20, 28, 38))
            try {
                $graphics.FillEllipse($hubBrush, [float]($cx - $hubRadius), [float]($cy - $hubRadius), [float]($hubRadius * 2.0), [float]($hubRadius * 2.0))
            }
            finally {
                $hubBrush.Dispose()
            }
        }
        finally {
            $dialBrush.Dispose()
            $ringPen.Dispose()
            $minutePen.Dispose()
            $hourPen.Dispose()
            $tickPen.Dispose()
        }
    }
    finally {
        $graphics.Dispose()
    }

    return $bitmap
}

function Save-ResizedPng {
    param(
        [Parameter(Mandatory = $true)]
        [System.Drawing.Bitmap]$Source,
        [Parameter(Mandatory = $true)]
        [int]$Size,
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $target = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.DrawImage($Source, 0, 0, $Size, $Size)
    }
    finally {
        $graphics.Dispose()
    }

    if ($null -ne (Split-Path -Parent $Path)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    }
    $target.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $target.Dispose()
}

function Write-IcoFromPngs {
    param(
        [Parameter(Mandatory = $true)]
        [string]$OutputPath,
        [Parameter(Mandatory = $true)]
        [hashtable]$PngPathBySize
    )

    $sizes = @($PngPathBySize.Keys | Sort-Object)
    $entries = @()
    $offset = 6 + (16 * $sizes.Count)
    foreach ($size in $sizes) {
        $bytes = [System.IO.File]::ReadAllBytes($PngPathBySize[$size])
        $entries += [PSCustomObject]@{
            Size   = [int]$size
            Bytes  = $bytes
            Offset = [int]$offset
        }
        $offset += $bytes.Length
    }

    if ($null -ne (Split-Path -Parent $OutputPath)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
    }

    $file = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $writer = New-Object System.IO.BinaryWriter($file)
    try {
        $writer.Write([UInt16]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]$entries.Count)

        foreach ($entry in $entries) {
            $dim = if ($entry.Size -ge 256) { 0 } else { $entry.Size }
            $writer.Write([byte]$dim)
            $writer.Write([byte]$dim)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]32)
            $writer.Write([UInt32]$entry.Bytes.Length)
            $writer.Write([UInt32]$entry.Offset)
        }

        foreach ($entry in $entries) {
            $writer.Write($entry.Bytes)
        }
    }
    finally {
        $writer.Dispose()
        $file.Dispose()
    }
}

$repoRoot = Get-RepoRoot
$tempDir = Join-Path $repoRoot 'target\icon-gen'
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

$master = New-ClockBitmap -Size 1024
try {
    $sizesToGenerate = @(16, 24, 32, 48, 64, 128, 180, 256)
    $pngBySize = @{}

    foreach ($size in $sizesToGenerate) {
        $targetPath = Join-Path $tempDir ("clock-{0}.png" -f $size)
        Save-ResizedPng -Source $master -Size $size -Path $targetPath
        $pngBySize[$size] = $targetPath
    }

    Copy-Item -LiteralPath $pngBySize[16] -Destination (Join-Path $repoRoot 'apps\browser-extension\icons\icon-16.png') -Force
    Copy-Item -LiteralPath $pngBySize[32] -Destination (Join-Path $repoRoot 'apps\browser-extension\icons\icon-32.png') -Force
    Copy-Item -LiteralPath $pngBySize[48] -Destination (Join-Path $repoRoot 'apps\browser-extension\icons\icon-48.png') -Force
    Copy-Item -LiteralPath $pngBySize[128] -Destination (Join-Path $repoRoot 'apps\browser-extension\icons\icon-128.png') -Force

    Copy-Item -LiteralPath $pngBySize[32] -Destination (Join-Path $repoRoot 'apps\web-ui\public\favicon-32.png') -Force
    Copy-Item -LiteralPath $pngBySize[64] -Destination (Join-Path $repoRoot 'apps\web-ui\public\favicon-64.png') -Force
    Copy-Item -LiteralPath $pngBySize[180] -Destination (Join-Path $repoRoot 'apps\web-ui\public\favicon-180.png') -Force

    $svgPath = Join-Path $repoRoot 'apps\web-ui\public\favicon.svg'
    $svgContent = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="26" fill="#ffffff" stroke="#1c242e" stroke-width="6"/>
  <line x1="32" y1="16" x2="32" y2="22" stroke="#141c26" stroke-width="4" stroke-linecap="round"/>
  <line x1="32" y1="32" x2="40" y2="20" stroke="#141c26" stroke-width="5" stroke-linecap="round"/>
  <line x1="32" y1="32" x2="46" y2="36" stroke="#141c26" stroke-width="4" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="3.5" fill="#141c26"/>
</svg>
'@
    Set-Content -LiteralPath $svgPath -Value $svgContent -Encoding UTF8

    Write-IcoFromPngs -OutputPath (Join-Path $repoRoot 'apps\timeline-backend\assets\timeline.ico') -PngPathBySize @{
        16  = $pngBySize[16]
        24  = $pngBySize[24]
        32  = $pngBySize[32]
        48  = $pngBySize[48]
        64  = $pngBySize[64]
        128 = $pngBySize[128]
        256 = $pngBySize[256]
    }
}
finally {
    $master.Dispose()
}

Write-Host "Generated unified white-dial icon set." -ForegroundColor Green
