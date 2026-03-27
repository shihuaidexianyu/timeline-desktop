//! GitHub Release based self-updater for the portable Windows package.

use crate::state::AgentState;
use anyhow::{Context, Result, anyhow, bail};
use reqwest::Client;
use semver::Version;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::{env, fs};
use tracing::info;

const RELEASES_LATEST_API: &str =
    "https://api.github.com/repos/shihuaidexianyu/timeline/releases/latest";
const PORTABLE_ASSET_PREFIX: &str = "timeline-portable-";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    published_at: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

struct PreparedRelease {
    release: GithubRelease,
    asset: GithubAsset,
    current_version: String,
    latest_version: String,
    has_update: bool,
}

struct UpdateScriptContext {
    parent_pid: u32,
    install_root: PathBuf,
    package_zip: PathBuf,
    restart_exe: PathBuf,
    restart_args: Vec<String>,
}

pub async fn check_for_updates() -> Result<common::AppUpdateInfo> {
    let prepared = prepare_release().await?;
    Ok(common::AppUpdateInfo {
        current_version: prepared.current_version,
        latest_version: prepared.latest_version,
        has_update: prepared.has_update,
        release_name: prepared.release.name,
        release_url: prepared.release.html_url,
        published_at: prepared.release.published_at,
        asset_name: prepared.asset.name.clone(),
    })
}

pub async fn install_latest_update(state: &AgentState) -> Result<common::InstallUpdateResponse> {
    let prepared = prepare_release().await?;
    if !prepared.has_update {
        bail!(
            "当前已经是最新版本 {}，无需重复升级",
            prepared.latest_version
        );
    }

    let current_exe = env::current_exe().context("failed to locate current executable")?;
    let install_root = current_exe
        .parent()
        .map(|path| path.to_path_buf())
        .context("failed to resolve install root from current executable")?;
    ensure_portable_install_root(&install_root)?;
    let update_dir = create_update_work_dir()?;
    let zip_path = update_dir.join(&prepared.asset.name);

    download_asset(&prepared.asset, &zip_path).await?;

    let script_path = update_dir.join("apply-update.ps1");
    let script = render_update_script(UpdateScriptContext {
        parent_pid: std::process::id(),
        install_root,
        package_zip: zip_path,
        restart_exe: current_exe,
        restart_args: build_restart_args(state),
    });
    fs::write(&script_path, script)
        .with_context(|| format!("failed to write updater script to {:?}", script_path))?;

    spawn_updater_script(&script_path)?;
    info!(
        target_version = %prepared.latest_version,
        asset_name = %prepared.asset.name,
        "portable updater started"
    );

    Ok(common::InstallUpdateResponse {
        started: true,
        target_version: prepared.latest_version,
        release_url: prepared.release.html_url,
        asset_name: prepared.asset.name.clone(),
    })
}

async fn prepare_release() -> Result<PreparedRelease> {
    let release = fetch_latest_release().await?;
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let latest_version = normalize_version(&release.tag_name)?;
    let current = parse_version(&current_version)?;
    let latest = parse_version(&latest_version)?;
    let asset = select_portable_asset(&release.assets)
        .ok_or_else(|| anyhow!("latest GitHub Release does not contain a portable zip asset"))?
        .clone();

    Ok(PreparedRelease {
        release,
        asset,
        current_version,
        latest_version,
        has_update: latest > current,
    })
}

async fn fetch_latest_release() -> Result<GithubRelease> {
    let client = Client::builder()
        .user_agent(format!("timeline-agent/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .context("failed to build GitHub release client")?;

    let response = client
        .get(RELEASES_LATEST_API)
        .send()
        .await
        .context("failed to request latest GitHub Release")?;
    let response = response
        .error_for_status()
        .context("latest GitHub Release request returned an error status")?;

    response
        .json::<GithubRelease>()
        .await
        .context("failed to parse latest GitHub Release payload")
}

async fn download_asset(asset: &GithubAsset, destination: &PathBuf) -> Result<()> {
    let client = Client::builder()
        .user_agent(format!("timeline-agent/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .context("failed to build GitHub asset download client")?;
    let response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .with_context(|| format!("failed to download {}", asset.name))?;
    let response = response
        .error_for_status()
        .with_context(|| format!("GitHub asset download failed for {}", asset.name))?;
    let bytes = response
        .bytes()
        .await
        .with_context(|| format!("failed to read downloaded bytes for {}", asset.name))?;

    fs::write(destination, &bytes)
        .with_context(|| format!("failed to write downloaded update zip to {:?}", destination))?;
    Ok(())
}

fn build_restart_args(state: &AgentState) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(config_path) = state.config_path() {
        args.push("--config".to_string());
        args.push(config_path.display().to_string());
    }
    args
}

fn create_update_work_dir() -> Result<PathBuf> {
    let stamp = time::OffsetDateTime::now_utc().unix_timestamp_nanos();
    let dir = env::temp_dir().join(format!("timeline-updater-{}-{}", std::process::id(), stamp));
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create update workspace {:?}", dir))?;
    Ok(dir)
}

fn ensure_portable_install_root(install_root: &Path) -> Result<()> {
    let has_packaged_web = install_root.join("web-ui").is_dir();
    let has_config_dir = install_root.join("config").is_dir();

    if has_packaged_web && has_config_dir {
        return Ok(());
    }

    bail!("在线升级仅支持 GitHub Release 解压后的便携版目录");
}

fn parse_version(value: &str) -> Result<Version> {
    Version::parse(value).with_context(|| format!("invalid semver version {value}"))
}

fn normalize_version(tag: &str) -> Result<String> {
    let trimmed = tag.trim();
    let normalized = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    Ok(parse_version(normalized)?.to_string())
}

fn select_portable_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    assets
        .iter()
        .find(|asset| asset.name.starts_with(PORTABLE_ASSET_PREFIX) && asset.name.ends_with(".zip"))
        .or_else(|| {
            assets
                .iter()
                .find(|asset| asset.name.ends_with(".zip") && asset.name.contains("portable"))
        })
}

fn render_update_script(context: UpdateScriptContext) -> String {
    format!(
        r#"$ErrorActionPreference = 'Stop'
$ParentPid = {parent_pid}
$InstallRoot = {install_root}
$PackageZip = {package_zip}
$RestartExe = {restart_exe}
$RestartArgs = {restart_args}

function Wait-ForProcessExit {{
    param([int]$Id)
    while (Get-Process -Id $Id -ErrorAction SilentlyContinue) {{
        Start-Sleep -Milliseconds 500
    }}
}}

function Resolve-StageRoot {{
    param([string]$ExtractDir)
    $entries = @(Get-ChildItem -LiteralPath $ExtractDir)
    if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {{
        return $entries[0].FullName
    }}

    return $ExtractDir
}}

function Copy-Directory {{
    param([string]$Source, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Source)) {{
        return
    }}
    if (Test-Path -LiteralPath $Destination) {{
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }}
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}}

function Copy-File {{
    param([string]$Source, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Source)) {{
        return
    }}
    $parent = Split-Path -Parent $Destination
    if ($parent) {{
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }}
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}}

Wait-ForProcessExit -Id $ParentPid

$workDir = Split-Path -Parent $PackageZip
$extractDir = Join-Path $workDir 'expanded'
if (Test-Path -LiteralPath $extractDir) {{
    Remove-Item -LiteralPath $extractDir -Recurse -Force
}}

Expand-Archive -LiteralPath $PackageZip -DestinationPath $extractDir -Force
$stageRoot = Resolve-StageRoot -ExtractDir $extractDir

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Copy-File (Join-Path $stageRoot 'timeline-agent.exe') (Join-Path $InstallRoot 'timeline-agent.exe')
Copy-Directory (Join-Path $stageRoot 'web-ui') (Join-Path $InstallRoot 'web-ui')
Copy-Directory (Join-Path $stageRoot 'browser-extension') (Join-Path $InstallRoot 'browser-extension')
Copy-File (Join-Path $stageRoot 'README-portable.txt') (Join-Path $InstallRoot 'README-portable.txt')

$configDir = Join-Path $InstallRoot 'config'
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
Copy-File (Join-Path $stageRoot 'config\timeline-agent.example.toml') (Join-Path $configDir 'timeline-agent.example.toml')
if (-not (Test-Path -LiteralPath (Join-Path $configDir 'timeline-agent.toml'))) {{
    Copy-File (Join-Path $stageRoot 'config\timeline-agent.toml') (Join-Path $configDir 'timeline-agent.toml')
}}

Start-Sleep -Milliseconds 250
if (Test-Path -LiteralPath $RestartExe) {{
    if ($RestartArgs.Count -gt 0) {{
        Start-Process -FilePath $RestartExe -ArgumentList $RestartArgs | Out-Null
    }} else {{
        Start-Process -FilePath $RestartExe | Out-Null
    }}
}}
"#,
        parent_pid = context.parent_pid,
        install_root = ps_string_literal(&context.install_root.display().to_string()),
        package_zip = ps_string_literal(&context.package_zip.display().to_string()),
        restart_exe = ps_string_literal(&context.restart_exe.display().to_string()),
        restart_args = ps_array_literal(&context.restart_args),
    )
}

fn ps_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn ps_array_literal(values: &[String]) -> String {
    if values.is_empty() {
        return "@()".to_string();
    }

    let items = values
        .iter()
        .map(|value| format!("    {}", ps_string_literal(value)))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("@(\n{items}\n)")
}

fn spawn_updater_script(script_path: &PathBuf) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                &script_path.display().to_string(),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .with_context(|| format!("failed to spawn updater script {:?}", script_path))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(anyhow!("self update is only supported on Windows"))
}

#[cfg(test)]
mod tests {
    use super::{GithubAsset, normalize_version, ps_array_literal, select_portable_asset};

    #[test]
    fn normalizes_versions_with_optional_v_prefix() {
        assert_eq!(normalize_version("v1.2.3").unwrap(), "1.2.3");
        assert_eq!(normalize_version("1.2.3").unwrap(), "1.2.3");
    }

    #[test]
    fn selects_portable_zip_asset() {
        let assets = vec![
            GithubAsset {
                name: "timeline-source.tar.gz".to_string(),
                browser_download_url: "https://example.com/source".to_string(),
            },
            GithubAsset {
                name: "timeline-portable-1.2.3.zip".to_string(),
                browser_download_url: "https://example.com/portable".to_string(),
            },
        ];

        assert_eq!(
            select_portable_asset(&assets).map(|asset| asset.name.as_str()),
            Some("timeline-portable-1.2.3.zip")
        );
    }

    #[test]
    fn renders_powershell_argument_array() {
        assert_eq!(ps_array_literal(&[]), "@()");
        assert!(ps_array_literal(&["--config".to_string()]).contains("'--config'"));
    }
}
