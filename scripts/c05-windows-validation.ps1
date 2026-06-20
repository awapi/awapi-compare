[CmdletBinding()]
param(
    [string]$DllPath = "src/shell-ext-win/build/Release/AwapiCompareShellExt.dll",
    [string]$ReportPath = "docs/c05-windows-validation-report.md",
    [switch]$RegisterDll
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    Write-Error 'This script only supports Windows.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$reportAbs = if ([System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $repoRoot $ReportPath }
$validatorAbs = Join-Path $repoRoot 'scripts/validate-shellext.ps1'

if (-not (Test-Path -Path $validatorAbs)) {
    Write-Error "Missing validator script: $validatorAbs"
}

function Ensure-ParentDirectory {
    param([string]$Path)
    $parent = Split-Path -Path $Path -Parent
    if (-not (Test-Path -Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

function Get-CommandVersion {
    param([string]$Name)
    try {
        $cmd = Get-Command -Name $Name -ErrorAction Stop
        return $cmd.Source
    } catch {
        return '<missing>'
    }
}

function To-MarkdownCodeBlock {
    param([string]$Text)
    return '```text' + "`n" + $Text + "`n" + '```'
}

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ssK'
$platform = [System.Environment]::OSVersion.VersionString
$cmakeVersion = '<missing>'
try {
    $cmakeVersion = (& cmake --version | Select-Object -First 1)
} catch {
    $cmakeVersion = '<missing>'
}

$toolingTable = @(
    "| Tool | Value |",
    "| --- | --- |",
    "| OS | $platform |",
    "| Timestamp | $timestamp |",
    "| cmake | $cmakeVersion |",
    "| cl.exe | $(Get-CommandVersion 'cl.exe') |",
    "| regsvr32.exe | $(Get-CommandVersion 'regsvr32.exe') |",
    "| signtool.exe | $(Get-CommandVersion 'signtool.exe') |"
) -join "`n"

$validatorOutput = ''
$validatorOk = $true
try {
    $args = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $validatorAbs)
    if ($RegisterDll) {
        $args += @('-RegisterDll')
    }
    $args += @('-DllPath', $DllPath)

    $validatorOutput = (& powershell.exe @args 2>&1 | Out-String)
} catch {
    $validatorOk = $false
    $validatorOutput = ($_ | Out-String)
}

$statusText = if ($validatorOk) { 'PASS' } else { 'FAIL' }

$report = @(
    '# C0.5 Windows Validation Report',
    '',
    '## Automated Checks',
    '',
    "Validator status: **$statusText**",
    '',
    $toolingTable,
    '',
    '### Validator Output',
    '',
    (To-MarkdownCodeBlock -Text $validatorOutput.TrimEnd()),
    '',
    '## Manual Explorer Runtime Checklist',
    '',
    '- [ ] Build native DLL (`just shellext`) completed on this machine.',
    '- [ ] Run app shell registration (`AwapiCompare.exe --register-shell`).',
    '- [ ] Restart Explorer (`taskkill /f /im explorer.exe`, then `start explorer.exe`).',
    '- [ ] Right-click exactly 2 files: **Compare with AwapiCompare** launches file compare tab.',
    '- [ ] Right-click exactly 2 folders: **Compare with AwapiCompare** launches folder compare tab.',
    '- [ ] Right-click one item: **Select Left Side for Compare** appears and works.',
    '- [ ] Right-click second item later: **Compare to <left>** label appears and works.',
    '- [ ] Mixed file+folder selection does not open a broken compare tab.',
    '- [ ] Temporarily move/rename app exe: Explorer verbs hide or fail safely (no Explorer crash).',
    '- [ ] Unregister shell (`AwapiCompare.exe --unregister-shell`) removes entries.',
    '',
    '## Windows 11 Compact Menu Gate',
    '',
    '- [ ] Sparse MSIX package prepared with FileExplorerContextMenus declaration.',
    '- [ ] Package signed with production identity.',
    '- [ ] Verbs appear in modern compact context menu (not only Show more options).',
    '',
    '## Notes',
    '',
    '- Keep C0.5 unchecked until all required runtime gates above are complete.',
    '- This report captures both automated registry validation and manual Explorer outcomes.'
) -join "`n"

Ensure-ParentDirectory -Path $reportAbs
Set-Content -Path $reportAbs -Value $report -Encoding UTF8

Write-Host "Wrote validation report: $reportAbs"
if (-not $validatorOk) {
    Write-Error 'Automated validator failed. See report for details.'
}
