<#
.SYNOPSIS
  Stages the AwapiCompare shell-extension DLL and packs the sparse MSIX
  (Windows 11 modern context menu) for one architecture.

.DESCRIPTION
  Copies the cargo-built awapi_shellex.dll for -Arch, stamps
  resources/msix/AppxManifest.template.xml and packs it with makeappx. Both
  land in resources/shellex/<arch>/ (picked up by electron-builder.yml
  `extraFiles`). The package holds only the manifest
  and a logo - the DLL/EXE stay in the install directory, which is passed
  as -ExternalLocation when the app registers the package at runtime.

  Unsigned by default (publisher carries the unsigned-package OID marker so
  `Add-AppxPackage -AllowUnsigned` accepts it). To sign instead, set
  AWAPI_MSIX_PUBLISHER to the certificate subject and AWAPI_MSIX_PFX /
  AWAPI_MSIX_PFX_PASSWORD to the certificate.

.EXAMPLE
  ./scripts/build-sparse-package.ps1 -Arch arm64
#>
param(
  [ValidateSet('x64', 'arm64')] [string] $Arch = 'x64',
  [string] $Version
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

if (-not $Version) {
  $pkgVersion = (Get-Content (Join-Path $root 'src/desktop/package.json') -Raw | ConvertFrom-Json).version
  # MSIX versions are four numeric parts; drop any semver prerelease suffix.
  $Version = (($pkgVersion -split '-')[0]) + '.0'
}

$publisher = $env:AWAPI_MSIX_PUBLISHER
if (-not $publisher) { $publisher = 'CN=Awapi, OID.2.25.311729368913984317654407730594956997722=1' }

function Find-SdkTool([string] $name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $kits = 'C:\Program Files (x86)\Windows Kits\10\bin'
  $hostArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $hit = Get-ChildItem $kits -Recurse -Filter $name -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -eq $hostArch } |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $hit) { throw "$name not found - install the Windows 10/11 SDK." }
  return $hit.FullName
}

$staging = Join-Path ([IO.Path]::GetTempPath()) "awapi-msix-$Arch"
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $staging 'Assets') -Force | Out-Null

(Get-Content (Join-Path $root 'resources/msix/AppxManifest.template.xml') -Raw).
  Replace('{{VERSION}}', $Version).
  Replace('{{ARCH}}', $Arch).
  Replace('{{PUBLISHER}}', [Security.SecurityElement]::Escape($publisher)) |
  Set-Content (Join-Path $staging 'AppxManifest.xml') -Encoding UTF8
Copy-Item (Join-Path $root 'resources/icon-512x512.png') (Join-Path $staging 'Assets/icon.png')

function Invoke-Tool([string] $exe, [string] $arguments) {
  # Start-Process rather than `& $exe`: under some Windows PowerShell 5.1 hosts
  # the call operator silently skips SDK tools (no output, no $LASTEXITCODE).
  $p = Start-Process -FilePath $exe -ArgumentList $arguments -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "$(Split-Path $exe -Leaf) failed ($($p.ExitCode))" }
}

$outDir = Join-Path $root "resources/shellex/$Arch"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# Stage the matching DLL (built by `cargo build --target <triple> --release`)
# next to the package; the manifest's com:Class Path points at shellex\<arch>\.
$triple = if ($Arch -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
$dll = Join-Path $root "src/shellex/target/$triple/release/awapi_shellex.dll"
if (-not (Test-Path $dll)) { throw "$dll not found - run cargo build --target $triple --release first." }
Copy-Item $dll $outDir -Force

$out = Join-Path $outDir 'awapi_shellex.msix'
# /nv: a sparse package's manifest names AwapiCompare.exe, which lives in the
# external location rather than the package, so semantic validation must be skipped.
Invoke-Tool (Find-SdkTool 'makeappx.exe') "pack /d `"$staging`" /p `"$out`" /nv /o"

if ($env:AWAPI_MSIX_PFX) {
  Invoke-Tool (Find-SdkTool 'signtool.exe') "sign /fd SHA256 /f `"$env:AWAPI_MSIX_PFX`" /p `"$env:AWAPI_MSIX_PFX_PASSWORD`" `"$out`""
}

Write-Host "Sparse package: $out ($Arch, $Version)"
