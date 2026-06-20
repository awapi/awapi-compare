[CmdletBinding()]
param(
    [string]$ExePath = 'release/win-arm64-unpacked/AwapiCompare.exe',
    [string]$DllPath = 'src/shell-ext-win/build/Release/AwapiCompareShellExt.dll',
    [string]$PendingLeftPath = "$env:APPDATA\AwapiCompare\pending-left.txt"
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Resolve-RepoPath {
    param([string]$Path)
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return (Join-Path $repoRoot $Path)
}

$exeAbs = Resolve-RepoPath $ExePath
$dllAbs = Resolve-RepoPath $DllPath

if (-not (Test-Path $exeAbs)) {
    throw "Exe not found: $exeAbs"
}
if (-not (Test-Path $dllAbs)) {
    throw "DLL not found: $dllAbs"
}

$pendingDir = Split-Path -Parent $PendingLeftPath
if (-not (Test-Path $pendingDir)) {
    New-Item -ItemType Directory -Path $pendingDir -Force | Out-Null
}

$clsidRoot = '{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A10}'
$clsidCompareTwo = '{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}'
$clsidSelectLeft = '{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}'
$clsidComparePending = '{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}'

$cmdStore = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell'
$idSetLeft = 'AwapiCompare.SelectLeft'
$idComparePending = 'AwapiCompare.ComparePending'
$idCompareTwo = 'AwapiCompare.CompareTwo'

$cfg = 'HKCU:\Software\Awapi\AwapiCompare'
New-Item -Path $cfg -Force | Out-Null
Set-ItemProperty -Path $cfg -Name 'ExePath' -Value $exeAbs
Set-ItemProperty -Path $cfg -Name 'PendingLeftPath' -Value $PendingLeftPath
Set-ItemProperty -Path $cfg -Name 'ShellExtPath' -Value $dllAbs

# An in-process COM shell handler must match Explorer's architecture. Detect the
# DLL's PE machine field and compare it to the host arch so we only bind the COM
# submenu when it can actually load (e.g. an x64 DLL cannot load into an arm64
# Explorer). Otherwise we fall back to a classic, DLL-free submenu.
function Get-AwapiHostArch {
    # Explorer always runs native. The HKLM Session Manager value reports the
    # true machine arch regardless of x64 emulation (where
    # $env:PROCESSOR_ARCHITECTURE would read AMD64 on an arm64 host).
    try {
        $arch = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name PROCESSOR_ARCHITECTURE -ErrorAction Stop).PROCESSOR_ARCHITECTURE
    } catch { $arch = $null }
    if (-not $arch) { $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE } }
    return $arch
}
function Test-AwapiDllLoadable {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try {
            $br = New-Object System.IO.BinaryReader($fs)
            $fs.Position = 0x3C
            $peOff = $br.ReadInt32()
            $fs.Position = $peOff + 4
            $machine = $br.ReadUInt16()
        } finally { $fs.Close() }
    } catch { return $false }
    switch (Get-AwapiHostArch) {
        'AMD64' { return ($machine -eq 0x8664) }
        'ARM64' { return ($machine -eq 0xAA64) }
        'x86' { return ($machine -eq 0x14C) }
        default { return $false }
    }
}

$dllLoadable = Test-AwapiDllLoadable $dllAbs
$hostArch = Get-AwapiHostArch
if ($dllLoadable) {
    Write-Host "Native handler DLL matches host arch ($hostArch); using COM submenu."
} else {
    Write-Host "Native handler DLL missing or arch-mismatched for $hostArch; using classic submenu."
}

$targets = @(
    'HKCU:\Software\Classes\*\shell\AwapiCompare',
    'HKCU:\Software\Classes\Directory\shell\AwapiCompare'
)
foreach ($t in $targets) {
    New-Item -Path $t -Force | Out-Null
    # Wipe every mode-specific value first so re-registration switches cleanly
    # between the COM submenu and the classic submenu. A stale root 'command'
    # subkey is what made Explorer show the "no app associated" file-open error.
    # -LiteralPath is required because the '*' file-class segment is otherwise
    # treated as a wildcard.
    Remove-ItemProperty -LiteralPath $t -Name 'MUIVerb' -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath $t -Name 'SubCommands' -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath $t -Name 'ExtendedSubCommandsKey' -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath $t -Name 'ExplorerCommandHandler' -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath ($t + '\command') -Recurse -Force -ErrorAction SilentlyContinue
    Set-ItemProperty -LiteralPath $t -Name '(default)' -Value 'AwapiCompare'
    Set-ItemProperty -LiteralPath $t -Name 'MultiSelectModel' -Value 'Player'
    Set-ItemProperty -LiteralPath $t -Name 'Icon' -Value ('"' + $exeAbs + '",0')
}

$verbMap = @(
    @{ Id = $idSetLeft; Label = 'Select as Left Side'; Command = ('"' + $exeAbs + '" --set-left "%1"'); Clsid = $clsidSelectLeft },
    @{ Id = $idComparePending; Label = 'Compare to Pending Left'; Command = ('"' + $exeAbs + '" --compare-pending "%1"'); Clsid = $clsidComparePending },
    @{ Id = $idCompareTwo; Label = 'Compare with AwapiCompare'; Command = ('"' + $exeAbs + '" --compare-add "%1"'); Clsid = $clsidCompareTwo }
)

foreach ($verb in $verbMap) {
    $key = Join-Path $cmdStore $verb.Id
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name '(default)' -Value $verb.Label
    Set-ItemProperty -Path $key -Name 'Icon' -Value ('"' + $exeAbs + '",0')
    if ($verb.Id -eq $idCompareTwo) {
        Set-ItemProperty -Path $key -Name 'MultiSelectModel' -Value 'Player'
    }
    New-Item -Path "$key\command" -Force | Out-Null
    Set-ItemProperty -Path "$key\command" -Name '(default)' -Value $verb.Command
    Remove-ItemProperty -Path $key -Name 'ExplorerCommandHandler' -ErrorAction SilentlyContinue
}

if ($dllLoadable) {
    $clsids = @($clsidRoot, $clsidCompareTwo, $clsidSelectLeft, $clsidComparePending)
    foreach ($clsid in $clsids) {
        $inproc = "HKCU:\Software\Classes\CLSID\$clsid\InprocServer32"
        New-Item -Path $inproc -Force | Out-Null
        Set-ItemProperty -Path $inproc -Name '(default)' -Value $dllAbs
        Set-ItemProperty -Path $inproc -Name 'ThreadingModel' -Value 'Apartment'
    }
    foreach ($t in $targets) {
        Set-ItemProperty -LiteralPath $t -Name 'ExplorerCommandHandler' -Value $clsidRoot
    }
    foreach ($verb in $verbMap) {
        $key = Join-Path $cmdStore $verb.Id
        Set-ItemProperty -Path $key -Name 'ExplorerCommandHandler' -Value $verb.Clsid
    }
    # Drop any stale classic cascade so the COM submenu is the only active path.
    Remove-Item -LiteralPath 'HKCU:\Software\Classes\AwapiCompare.Cascade' -Recurse -Force -ErrorAction SilentlyContinue
} else {
    # Classic, DLL-free submenu via ExtendedSubCommandsKey. The SubCommands +
    # CommandStore mechanism is unreliable for per-user (HKCU) registration —
    # Explorer frequently renders an EMPTY submenu. ExtendedSubCommandsKey points
    # at a dedicated class key whose shell\ subkeys are the verbs; this populates
    # reliably per-user and needs no native DLL.
    $cascade = 'HKCU:\Software\Classes\AwapiCompare.Cascade'
    $cascadeShell = $cascade + '\shell'
    Remove-Item -LiteralPath $cascade -Recurse -Force -ErrorAction SilentlyContinue
    $cascadeVerbs = @(
        @{ Key = '01SelectLeft'; Label = 'Select as Left Side'; Command = ('"' + $exeAbs + '" --set-left "%1"'); Multi = $false },
        @{ Key = '02ComparePending'; Label = 'Compare to Pending Left'; Command = ('"' + $exeAbs + '" --compare-pending "%1"'); Multi = $false },
        @{ Key = '03CompareTwo'; Label = 'Compare with AwapiCompare'; Command = ('"' + $exeAbs + '" --compare-add "%1"'); Multi = $true }
    )
    foreach ($cv in $cascadeVerbs) {
        $ck = Join-Path $cascadeShell $cv.Key
        New-Item -Path "$ck\command" -Force | Out-Null
        Set-ItemProperty -Path $ck -Name '(default)' -Value $cv.Label
        if ($cv.Multi) { Set-ItemProperty -Path $ck -Name 'MultiSelectModel' -Value 'Player' }
        Set-ItemProperty -Path "$ck\command" -Name '(default)' -Value $cv.Command
    }
    foreach ($t in $targets) {
        Set-ItemProperty -LiteralPath $t -Name 'MUIVerb' -Value 'AwapiCompare'
        Set-ItemProperty -LiteralPath $t -Name 'ExtendedSubCommandsKey' -Value 'AwapiCompare.Cascade'
    }
}

Write-Host "Registered local shell integration using:"
Write-Host "- ExePath: $exeAbs"
Write-Host "- DllPath: $dllAbs"
Write-Host "- PendingLeftPath: $PendingLeftPath"
