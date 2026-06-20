[CmdletBinding()]
param(
    [switch]$AutoRun,
    [switch]$RegisterDll,
    [string]$DllPath = 'src/shell-ext-win/build/Release/AwapiCompareShellExt.dll',
    [string]$ReportPath = 'docs/c05-windows-validation-report.md'
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    Write-Error 'This bootstrap script only supports Windows.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Resolve-Exe {
    param([string]$Name)
    try {
        $cmd = Get-Command -Name $Name -ErrorAction Stop
        return $cmd.Source
    } catch {
        if ($Name -ieq 'cmake') {
            $candidates = @(
                'C:\Program Files\CMake\bin\cmake.exe',
                'C:\Program Files (x86)\CMake\bin\cmake.exe'
            )
            foreach ($candidate in $candidates) {
                if (Test-Path -Path $candidate) {
                    return $candidate
                }
            }
        }
        return $null
    }
}

function Test-VsBuildTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -Path $vswhere)) {
        return $false
    }

    $installPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath

    return (-not [string]::IsNullOrWhiteSpace($installPath))
}

function Get-VsBuildToolsHealth {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -Path $vswhere)) {
        return [pscustomobject]@{ Present = $false; Complete = $false; InstallationPath = $null }
    }

    $json = & $vswhere -all -products * -format json
    if ([string]::IsNullOrWhiteSpace($json)) {
        return [pscustomobject]@{ Present = $false; Complete = $false; InstallationPath = $null }
    }

    $instances = $json | ConvertFrom-Json
    if (-not $instances -or $instances.Count -eq 0) {
        return [pscustomobject]@{ Present = $false; Complete = $false; InstallationPath = $null }
    }

    $buildTools = $instances | Where-Object { $_.productId -eq 'Microsoft.VisualStudio.Product.BuildTools' } | Select-Object -First 1
    if (-not $buildTools) {
        return [pscustomobject]@{ Present = $false; Complete = $false; InstallationPath = $null }
    }

    return [pscustomobject]@{
        Present = $true
        Complete = [bool]$buildTools.isComplete
        InstallationPath = $buildTools.installationPath
    }
}

function Write-MissingToolingHelp {
    param(
        [string[]]$Missing,
        [pscustomobject]$VsHealth
    )

    Write-Host ''
    Write-Host 'Missing prerequisites detected:'
    $Missing | ForEach-Object { Write-Host ("- {0}" -f $_) }
    Write-Host ''
    Write-Host 'Install commands (run in elevated PowerShell):'

    if ($Missing -contains 'cmake') {
        Write-Host 'winget install --id Kitware.CMake --exact --source winget'
    }

    if ($Missing -contains 'vs-build-tools') {
        Write-Host 'winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621"'

        if ($VsHealth -and $VsHealth.Present -and (-not $VsHealth.Complete)) {
            Write-Host ''
            Write-Host '# Existing Build Tools instance is incomplete. Repair path:'
            Write-Host '"C:\Program Files (x86)\Microsoft Visual Studio\Installer\InstallCleanup.exe" -f'
            Write-Host 'winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --accept-package-agreements --accept-source-agreements --override "--passive --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621"'
        }
    }

    if ($Missing -contains 'signtool') {
        Write-Host 'winget install --id Microsoft.WindowsSDK.10.0.22621 --exact --source winget'
        Write-Host '# Note: signtool is only required for the signed MSIX compact-menu gate.'
    }

    Write-Host ''
    Write-Host 'After install, re-run:'
    Write-Host 'powershell -ExecutionPolicy Bypass -File scripts/bootstrap-c05-windows.ps1 -AutoRun -RegisterDll'
}

$cmakePath = Resolve-Exe -Name 'cmake'
$regsvrPath = Resolve-Exe -Name 'regsvr32.exe'
$signtoolPath = Resolve-Exe -Name 'signtool.exe'
$hasVsBuildTools = Test-VsBuildTools
$vsHealth = Get-VsBuildToolsHealth

$missing = @()
$requiredMissing = @()
if (-not $cmakePath) { $missing += 'cmake' }
if (-not $hasVsBuildTools) { $missing += 'vs-build-tools' }
if (-not $signtoolPath) { $missing += 'signtool' }
if (-not $regsvrPath) { $missing += 'regsvr32' }

if (-not $cmakePath) { $requiredMissing += 'cmake' }
if (-not $hasVsBuildTools) { $requiredMissing += 'vs-build-tools' }
if (-not $regsvrPath) { $requiredMissing += 'regsvr32' }

Write-Host 'C0.5 Windows bootstrap status:'
Write-Host ("- cmake: {0}" -f ($(if ($cmakePath) { $cmakePath } else { '<missing>' })))
Write-Host ("- Visual Studio C++ + Windows SDK: {0}" -f ($(if ($hasVsBuildTools) { 'present' } else { 'missing' })))
if ($vsHealth.Present) {
    Write-Host ("- VS Build Tools instance path: {0}" -f $vsHealth.InstallationPath)
    Write-Host ("- VS Build Tools instance complete: {0}" -f $vsHealth.Complete)
}
Write-Host ("- regsvr32.exe: {0}" -f ($(if ($regsvrPath) { $regsvrPath } else { '<missing>' })))
Write-Host ("- signtool.exe: {0}" -f ($(if ($signtoolPath) { $signtoolPath } else { '<missing>' })))

if ($missing.Count -gt 0) {
    Write-MissingToolingHelp -Missing $missing -VsHealth $vsHealth
    if (-not $AutoRun) {
        exit 1
    }
    if ($requiredMissing.Count -gt 0) {
        Write-Error 'Cannot continue auto-run until required prerequisites are installed.'
    }
    Write-Host 'Continuing auto-run without optional tools (signtool missing).'
}

if (-not $AutoRun) {
    Write-Host ''
    Write-Host 'Prerequisites look good. Run with -AutoRun to execute build + validation.'
    exit 0
}

Push-Location $repoRoot
try {
    Write-Host ''
    Write-Host 'Building native shell extension (C0.5)...'
    & $cmakePath -S src/shell-ext-win -B src/shell-ext-win/build -A x64
    if ($LASTEXITCODE -ne 0) { throw 'cmake configure failed' }

    & $cmakePath --build src/shell-ext-win/build --config Release
    if ($LASTEXITCODE -ne 0) { throw 'cmake build failed' }

    Write-Host ''
    Write-Host 'Running shell extension validator...'
    $validateArgs = @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'scripts/validate-shellext.ps1',
        '-DllPath',
        $DllPath
    )
    if ($RegisterDll) { $validateArgs += '-RegisterDll' }
    & powershell.exe @validateArgs
    if ($LASTEXITCODE -ne 0) { throw 'validate-shellext failed' }

    Write-Host ''
    Write-Host 'Generating C0.5 validation report...'
    $reportArgs = @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'scripts/c05-windows-validation.ps1',
        '-DllPath',
        $DllPath,
        '-ReportPath',
        $ReportPath
    )
    if ($RegisterDll) { $reportArgs += '-RegisterDll' }
    & powershell.exe @reportArgs
    if ($LASTEXITCODE -ne 0) { throw 'c05-windows-validation failed' }

    Write-Host ''
    Write-Host 'C0.5 bootstrap completed successfully.'
} finally {
    Pop-Location
}
