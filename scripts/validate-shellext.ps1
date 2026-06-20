[CmdletBinding()]
param(
    [string]$DllPath = "src/shell-ext-win/build/Release/AwapiCompareShellExt.dll",
    [switch]$RegisterDll
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    Write-Error 'This validator only supports Windows.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dllAbs = if ([System.IO.Path]::IsPathRooted($DllPath)) { $DllPath } else { Join-Path $repoRoot $DllPath }

$clsidRoot = '{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A10}'
$clsidCompareTwo = '{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}'
$clsidSelectLeft = '{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}'
$clsidComparePending = '{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}'

$checks = @()

function Add-Check {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Details
    )
    $script:checks += [pscustomobject]@{
        Name = $Name
        Passed = $Passed
        Details = $Details
    }
}

function Key-Exists {
    param([string]$Path)
    return [bool](Test-Path -LiteralPath $Path)
}

function Read-DefaultValue {
    param([string]$Path)
    try {
        return (Get-Item -LiteralPath $Path).GetValue('')
    } catch {
        return $null
    }
}

if ($RegisterDll) {
    if (-not (Test-Path -Path $dllAbs)) {
        Write-Error "DLL not found: $dllAbs"
    }
    Write-Host "Registering DLL with regsvr32: $dllAbs"
    $proc = Start-Process -FilePath regsvr32.exe -ArgumentList '/s', $dllAbs -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        Write-Error "regsvr32 failed with exit code $($proc.ExitCode)"
    }
}

$commandStoreBase = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell'
$cfg = 'HKCU:\Software\Awapi\AwapiCompare'
$rootKeys = @(
    'HKCU:\Software\Classes\*\shell\AwapiCompare',
    'HKCU:\Software\Classes\Directory\shell\AwapiCompare'
)

foreach ($rootKey in $rootKeys) {
    $rootExists = Key-Exists -Path $rootKey
    Add-Check -Name "Root shell key exists ($rootKey)" -Passed $rootExists -Details $rootKey
    if ($rootExists) {
        $handler = (Get-ItemProperty -LiteralPath $rootKey -ErrorAction SilentlyContinue).ExplorerCommandHandler
        Add-Check -Name "Root ExplorerCommandHandler bound ($rootKey)" -Passed ($handler -eq $clsidRoot) -Details "expected=$clsidRoot actual=$handler"
    } else {
        Add-Check -Name "Root ExplorerCommandHandler bound ($rootKey)" -Passed $false -Details 'root shell key missing'
    }
}

$verbKeys = @(
    @{ Id = 'AwapiCompare.CompareTwo'; Clsid = $clsidCompareTwo },
    @{ Id = 'AwapiCompare.SelectLeft'; Clsid = $clsidSelectLeft },
    @{ Id = 'AwapiCompare.ComparePending'; Clsid = $clsidComparePending }
)

Add-Check -Name 'DLL exists' -Passed (Test-Path -Path $dllAbs) -Details $dllAbs

$rootInproc = "HKCU:\Software\Classes\CLSID\$clsidRoot\InprocServer32"
$rootInprocExists = Key-Exists -Path $rootInproc
Add-Check -Name "CLSID InprocServer32 exists ($clsidRoot)" -Passed $rootInprocExists -Details $rootInproc
if ($rootInprocExists) {
    $defaultValue = Read-DefaultValue -Path $rootInproc
    $threadingModel = (Get-ItemProperty -Path $rootInproc -ErrorAction SilentlyContinue).ThreadingModel
    $dllMatch = $false
    if ($defaultValue) {
        try {
            $dllMatch = ([System.IO.Path]::GetFullPath($defaultValue) -eq [System.IO.Path]::GetFullPath($dllAbs))
        } catch {
            $dllMatch = $false
        }
    }
    Add-Check -Name "CLSID DLL path matches ($clsidRoot)" -Passed $dllMatch -Details "expected=$dllAbs actual=$defaultValue"
    Add-Check -Name "ThreadingModel Apartment ($clsidRoot)" -Passed ($threadingModel -eq 'Apartment') -Details "actual=$threadingModel"
} else {
    Add-Check -Name "CLSID DLL path matches ($clsidRoot)" -Passed $false -Details 'inproc key missing'
    Add-Check -Name "ThreadingModel Apartment ($clsidRoot)" -Passed $false -Details 'inproc key missing'
}

foreach ($verb in $verbKeys) {
    $k = Join-Path $commandStoreBase $verb.Id
    $exists = Key-Exists -Path $k
    Add-Check -Name "CommandStore key exists ($($verb.Id))" -Passed $exists -Details $k

    if ($exists) {
        $handler = (Get-ItemProperty -Path $k -ErrorAction SilentlyContinue).ExplorerCommandHandler
        Add-Check -Name "ExplorerCommandHandler bound ($($verb.Id))" -Passed ($handler -eq $verb.Clsid) -Details "expected=$($verb.Clsid) actual=$handler"
    } else {
        Add-Check -Name "ExplorerCommandHandler bound ($($verb.Id))" -Passed $false -Details 'verb key missing'
    }

    $inproc = "HKCU:\Software\Classes\CLSID\$($verb.Clsid)\InprocServer32"
    $inprocExists = Key-Exists -Path $inproc
    Add-Check -Name "CLSID InprocServer32 exists ($($verb.Clsid))" -Passed $inprocExists -Details $inproc

    if ($inprocExists) {
        $defaultValue = Read-DefaultValue -Path $inproc
        $threadingModel = (Get-ItemProperty -Path $inproc -ErrorAction SilentlyContinue).ThreadingModel
        $dllMatch = $false
        if ($defaultValue) {
            try {
                $dllMatch = ([System.IO.Path]::GetFullPath($defaultValue) -eq [System.IO.Path]::GetFullPath($dllAbs))
            } catch {
                $dllMatch = $false
            }
        }
        Add-Check -Name "CLSID DLL path matches ($($verb.Clsid))" -Passed $dllMatch -Details "expected=$dllAbs actual=$defaultValue"
        Add-Check -Name "ThreadingModel Apartment ($($verb.Clsid))" -Passed ($threadingModel -eq 'Apartment') -Details "actual=$threadingModel"
    } else {
        Add-Check -Name "CLSID DLL path matches ($($verb.Clsid))" -Passed $false -Details 'inproc key missing'
        Add-Check -Name "ThreadingModel Apartment ($($verb.Clsid))" -Passed $false -Details 'inproc key missing'
    }
}

$cfgExists = Key-Exists -Path $cfg
Add-Check -Name 'Awapi config key exists' -Passed $cfgExists -Details $cfg
if ($cfgExists) {
    $cfgProps = Get-ItemProperty -Path $cfg -ErrorAction SilentlyContinue
    Add-Check -Name 'ExePath configured' -Passed (-not [string]::IsNullOrWhiteSpace($cfgProps.ExePath)) -Details "ExePath=$($cfgProps.ExePath)"
    Add-Check -Name 'PendingLeftPath configured' -Passed (-not [string]::IsNullOrWhiteSpace($cfgProps.PendingLeftPath)) -Details "PendingLeftPath=$($cfgProps.PendingLeftPath)"
} else {
    Add-Check -Name 'ExePath configured' -Passed $false -Details 'config key missing'
    Add-Check -Name 'PendingLeftPath configured' -Passed $false -Details 'config key missing'
}

$checks | ForEach-Object {
    $state = if ($_.Passed) { 'PASS' } else { 'FAIL' }
    Write-Host ("[{0}] {1} :: {2}" -f $state, $_.Name, $_.Details)
}

$failed = @($checks | Where-Object { -not $_.Passed })
if ($failed.Count -gt 0) {
    Write-Error ("Validation failed: {0} checks failed." -f $failed.Count)
}

Write-Host 'Shell extension validation succeeded.'
