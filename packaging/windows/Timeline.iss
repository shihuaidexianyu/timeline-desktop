#define MyAppName "Timeline"
#define MyAppPublisher "Timeline"
#define MyAppExeName "timeline-agent.exe"
#define MyAppId "{{A8B4EB7E-4B8E-4CA0-A593-2974E2D9E0C8}"

#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif

#ifndef StageDir
  #error StageDir must be provided to the installer build.
#endif

#ifndef OutputDir
  #define OutputDir AddBackslash(SourcePath) + "..\\..\\target\\installer\\output"
#endif

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Timeline
DefaultGroupName=Timeline
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
OutputDir={#OutputDir}
OutputBaseFilename=timeline-setup-{#MyAppVersion}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked
Name: "launchafterinstall"; Description: "安装完成后启动 Timeline"; Flags: checkedonce
Name: "openui"; Description: "安装完成后打开仪表盘"; Flags: unchecked

[Dirs]
Name: "{localappdata}\Timeline"
Name: "{localappdata}\Timeline\data"
Name: "{localappdata}\Timeline\config"

[Files]
Source: "{#StageDir}\app\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\web-ui\dist\*"; DestDir: "{app}\web-ui\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\browser-extension\*"; DestDir: "{app}\browser-extension"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\docs\README-install.txt"; DestDir: "{app}"; DestName: "README-install.txt"; Flags: ignoreversion
Source: "{#StageDir}\config\timeline-agent.example.toml"; DestDir: "{app}\config"; Flags: ignoreversion

[Icons]
Name: "{group}\Timeline Agent"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--config ""{code:GetConfigPath}"""
Name: "{group}\Timeline Dashboard"; Filename: "{code:GetWebUiUrl}"
Name: "{group}\浏览器扩展目录"; Filename: "{app}\browser-extension"
Name: "{group}\安装说明"; Filename: "{app}\README-install.txt"
Name: "{commondesktop}\Timeline"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--config ""{code:GetConfigPath}"""; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--config ""{code:GetConfigPath}"""; Description: "启动 Timeline"; Flags: nowait postinstall skipifsilent; Tasks: launchafterinstall
Filename: "{code:GetWebUiUrl}"; Description: "打开 Timeline 仪表盘"; Flags: postinstall skipifsilent shellexec unchecked; Tasks: openui

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c taskkill /IM {#MyAppExeName} /F"; Flags: runhidden skipifdoesntexist

[Code]
function GetLocalDataRoot(): string;
begin
  Result := ExpandConstant('{localappdata}\Timeline');
end;

function NormalizeTomlPath(Value: string): string;
begin
  StringChangeEx(Value, '\', '/', True);
  Result := Value;
end;

function GetConfigPath(Param: string): string;
begin
  Result := ExpandConstant('{localappdata}\Timeline\config\timeline-agent.toml');
end;

function GetWebUiUrl(Param: string): string;
begin
  Result := 'http://127.0.0.1:46215/#/stats';
end;

procedure EnsureUserConfig();
var
  ConfigPath: string;
  ConfigDir: string;
  DataDir: string;
  Content: string;
begin
  ConfigPath := GetConfigPath('');
  if FileExists(ConfigPath) then
    exit;

  ConfigDir := ExtractFileDir(ConfigPath);
  DataDir := ExpandConstant('{localappdata}\Timeline\data');
  ForceDirectories(ConfigDir);
  ForceDirectories(DataDir);

  Content :=
    '# Timeline installed configuration' + #13#10 +
    'database_path = "' + NormalizeTomlPath(AddBackslash(DataDir) + 'timeline.sqlite') + '"' + #13#10 +
    'lockfile_path = "' + NormalizeTomlPath(AddBackslash(DataDir) + 'timeline-agent.lock') + '"' + #13#10 +
    'listen_addr = "127.0.0.1:46215"' + #13#10 +
    'web_ui_url = "http://127.0.0.1:46215/#/stats"' + #13#10 +
    'idle_threshold_secs = 300' + #13#10 +
    'poll_interval_millis = 1000' + #13#10 +
    'debug = false' + #13#10 +
    'tray_enabled = true' + #13#10 +
    'record_window_titles = true' + #13#10 +
    'record_page_titles = true' + #13#10 +
    'ignored_apps = []' + #13#10 +
    'ignored_domains = []' + #13#10;

  SaveStringToFile(ConfigPath, Content, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    EnsureUserConfig();
end;
