param(
    [ValidateSet('release')]
    [string]$Profile = 'release',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Require-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "Required command '$Name' was not found in PATH."
    }

    return $command.Source
}

function Get-IsccPath {
    $command = Get-Command 'iscc.exe' -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    $candidates = @(
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe'
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "Inno Setup Compiler (ISCC.exe) was not found. Install Inno Setup 6 first."
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

$repoRoot = Get-RepoRoot
$webUiDir = Join-Path $repoRoot 'apps\web-ui'
$agentDir = Join-Path $repoRoot 'apps\timeline-agent'
$extensionDir = Join-Path $repoRoot 'apps\browser-extension'
$stageRoot = Join-Path $repoRoot 'target\installer\stage'
$outputRoot = Join-Path $repoRoot 'target\installer\output'
$issPath = Join-Path $repoRoot 'packaging\windows\Timeline.iss'
$isccPath = Get-IsccPath

$cargoMetadataJson = & cargo metadata --no-deps --format-version 1 --manifest-path (Join-Path $repoRoot 'Cargo.toml')
$cargoMetadata = $cargoMetadataJson | ConvertFrom-Json
$packageVersion = ($cargoMetadata.packages | Where-Object { $_.name -eq 'timeline-agent' } | Select-Object -First 1).version

if ([string]::IsNullOrWhiteSpace($packageVersion)) {
    throw 'Failed to resolve timeline-agent version from cargo metadata.'
}

if (-not $SkipBuild) {
    Require-Command -Name 'cargo' | Out-Null
    Require-Command -Name 'npm' | Out-Null

    Write-Host 'Building web-ui...' -ForegroundColor Cyan
    Push-Location $webUiDir
    try {
        & npm run build
    }
    finally {
        Pop-Location
    }

    Write-Host 'Building timeline-agent...' -ForegroundColor Cyan
    Push-Location $repoRoot
    try {
        & cargo build --profile $Profile -p timeline-agent
    }
    finally {
        Pop-Location
    }
}

$agentBinary = Join-Path $repoRoot "target\$Profile\timeline-agent.exe"
$webUiDist = Join-Path $webUiDir 'dist'

if (-not (Test-Path $agentBinary)) {
    throw "Expected agent binary was not found: $agentBinary"
}

if (-not (Test-Path (Join-Path $webUiDist 'index.html'))) {
    throw "Expected web-ui build output was not found: $webUiDist"
}

Remove-Item -Path $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$appStage = Join-Path $stageRoot 'app'
$webUiStage = Join-Path $stageRoot 'web-ui\dist'
$extensionStage = Join-Path $stageRoot 'browser-extension'
$configStage = Join-Path $stageRoot 'config'
$docsStage = Join-Path $stageRoot 'docs'

New-Item -ItemType Directory -Path $appStage, $webUiStage, $extensionStage, $configStage, $docsStage -Force | Out-Null

Copy-Item -Path $agentBinary -Destination (Join-Path $appStage 'timeline-agent.exe') -Force
Copy-DirectoryContents -Source $webUiDist -Destination $webUiStage
Copy-DirectoryContents -Source $extensionDir -Destination $extensionStage
Copy-Item -Path (Join-Path $repoRoot 'config\timeline-agent.example.toml') -Destination (Join-Path $configStage 'timeline-agent.example.toml') -Force

$installReadme = @'
Timeline 安装包内容
====================

安装后会包含：

1. timeline-agent.exe
2. 内置的 web-ui/dist 前端静态文件
3. browser-extension 浏览器扩展目录

安装版默认把用户数据写到：
%LOCALAPPDATA%\Timeline\data

安装版默认把运行配置写到：
%LOCALAPPDATA%\Timeline\config\timeline-agent.toml

浏览器扩展安装方法
------------------

1. 打开 edge://extensions 或 chrome://extensions
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 指向安装目录下的 browser-extension 文件夹
'@

Set-Content -Path (Join-Path $docsStage 'README-install.txt') -Value $installReadme -Encoding UTF8

Write-Host "Packaging installer with Inno Setup..." -ForegroundColor Cyan
& $isccPath `
    "/DMyAppVersion=$packageVersion" `
    "/DStageDir=$stageRoot" `
    "/DOutputDir=$outputRoot" `
    $issPath

$installer = Get-ChildItem -Path $outputRoot -Filter "timeline-setup-$packageVersion*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($null -eq $installer) {
    throw 'Installer build finished but no setup executable was found.'
}

Write-Host "Installer ready: $($installer.FullName)" -ForegroundColor Green
