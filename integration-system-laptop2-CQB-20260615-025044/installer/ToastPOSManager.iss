; ToastPOSManager Inno Setup Script
; One-click installer for Windows 10/11
; Requires Inno Setup 6.x — https://jrsoftware.org/isinfo.php
; Build: cd installer && .\build_installer.ps1
;
; Update-safe: NEVER deletes C:\ProgramData\ToastPOSManager (user data)
; Silent install: ToastPOSManagerSetup-<version>.exe /VERYSILENT /NORESTART
; Log: /LOG="C:\ProgramData\ToastPOSManager\logs\installer-update.log"

#define MyAppName       "ToastPOSManager"
#define MyAppVersion    "1.2.0"
#define MyAppPublisher  "Bakudan Ramen"
#define MyAppURL        "https://bakudanramen.com"
#define MyAppExeName    "ToastPOSManager.exe"
; App binaries — install to Program Files (system)
; User DATA stays in C:\ProgramData\ToastPOSManager\ (NEVER touched by installer)
#define MyDataDir       "{commonappdata}\ToastPOSManager"

[Setup]
AppId={{8A6F3D2C-4E7B-4A1F-9C3D-1B2E5F8A9D0E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\release
OutputBaseFilename=ToastPOSManagerSetup-{#MyAppVersion}
SetupIconFile=..\desktop-app\assets\icon.ico
WizardStyle=modern
Compression=lzma
SolidCompression=yes
WizardSmallImageFile=..\desktop-app\assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
; Stop running app before installing
CloseApplications=yes
CloseApplicationsFilter=*.exe
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Installer
; Allow logging for update traceability
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startup";     Description: "Start background agent with Windows"; GroupDescription: "Startup options:"; Flags: checked

[Files]
; App binaries — go to Program Files
Source: "..\dist\ToastPOSManager.exe";           DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\ToastPOSManagerBackground.exe"; DestDir: "{app}"; Flags: ignoreversion; Check: FileExists('..\dist\ToastPOSManagerBackground.exe')
; First-run config template — only copy if no config exists yet
Source: "..\desktop-app\local-config.example.json"; DestDir: "{app}"; DestName: "local-config.example.json"; Flags: ignoreversion
; Assets
Source: "..\desktop-app\assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: DirExists('..\desktop-app\assets')
; version.json — used by update_client.py to know installed version
Source: "..\desktop-app\version.json"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}";                         Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}";   Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}";                   Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\{#MyAppPublisher}\{#MyAppName}"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletesubkey
Root: HKCU; Subkey: "Software\{#MyAppPublisher}\{#MyAppName}"; ValueType: string; ValueName: "Version"; ValueData: "{#MyAppVersion}"; Flags: uninsdeletevalue

[Run]
; After install, launch first-run wizard (interactive mode only)
Filename: "{app}\{#MyAppExeName}"; Parameters: "--first-run"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Remove scheduled task on uninstall — never deletes user data
Filename: "schtasks.exe"; Parameters: "/Delete /TN ""ToastPOSManager-Background"" /F"; Flags: runhidden; RunOnceId: "RemoveScheduledTask"

[Code]
{ ── Helpers ──────────────────────────────────────────────────────────── }
function GetDataDir(): String;
begin
  Result := ExpandConstant('{commonappdata}\ToastPOSManager');
end;

{ ── Main post-install step ────────────────────────────────────────────── }
procedure CurStepChanged(CurStep: TSetupStep);
var
  AppExePath, DataDir: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    AppExePath := ExpandConstant('{app}\ToastPOSManagerBackground.exe');
    DataDir    := GetDataDir();

    { Create user data directories — safe to call even on update (dirs already exist) }
    ForceDirectories(DataDir);
    ForceDirectories(DataDir + '\config');
    ForceDirectories(DataDir + '\runtime');
    ForceDirectories(DataDir + '\runtime\reporting-outbox');
    ForceDirectories(DataDir + '\logs\qb-activity');
    ForceDirectories(DataDir + '\logs\reporting-events');
    ForceDirectories(DataDir + '\db');
    ForceDirectories(DataDir + '\backups');
    ForceDirectories(DataDir + '\updates');

    { ─── Scheduled task for background agent ───────────────────────── }
    if IsTaskSelected('startup') then
    begin
      { Stop existing task first if running (update scenario) }
      Exec('schtasks.exe',
        '/End /TN "ToastPOSManager-Background"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

      { Delete old task definition }
      Exec('schtasks.exe',
        '/Delete /F /TN "ToastPOSManager-Background"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

      { Create fresh task at ONLOGON }
      Exec('schtasks.exe',
        '/Create /F /SC ONLOGON /TN "ToastPOSManager-Background" ' +
        '/TR "\"' + AppExePath + '\" --background" ' +
        '/RL HIGHEST /DELAY 0001:00',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

      { Start it immediately (silent/update install) }
      if WizardSilent() then
        Exec('schtasks.exe',
          '/Run /TN "ToastPOSManager-Background"',
          '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;

{ ── Safety: never allow uninstall to remove user data ─────────────────── }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  { intentionally empty — data dir is NOT removed on uninstall }
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;
