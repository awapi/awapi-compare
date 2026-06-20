; Custom NSIS macros included by electron-builder.
; electron-builder calls these four macros at the appropriate install/uninstall
; phases. The install hook registers the Explorer integration best-effort using
; the freshly installed app binary, and the uninstall hook removes the same
; registry keys best-effort.

; ---- Install phase ---------------------------------------------------------
; Register the Explorer context menu entries using the installed app's own
; `--register-shell` flow. This keeps the installer logic thin and reuses the
; same shell-registration code path as the in-app Preferences toggle.
;
; Safety contract: best-effort only. A failure here must never block install.
; The same ClearErrors / Pop / ClearErrors pattern is used as in uninstall.
!macro customInstall
  ClearErrors
  DetailPrint "Registering AwapiCompare Explorer context menu entries (best-effort)..."
  nsExec::ExecToLog '"$INSTDIR\AwapiCompare.exe" --register-shell'
  Pop $0
  ClearErrors
!macroend

!macro customUnInstall
!macroend

!macro un.customInstall
!macroend

; ---- Uninstall phase -------------------------------------------------------
; Remove the HKCU registry keys written by ShellIntegrationService.register().
;
; Safety contract: this step is BEST-EFFORT only. Even if PowerShell is absent,
; the keys don't exist, or the process exits non-zero, the uninstall continues
; without any error.  This is guaranteed by:
;
;   1. ClearErrors before the exec — wipes any pre-existing NSIS error flag.
;   2. Pop $0 after nsExec::ExecToLog — every nsExec call pushes its exit code
;      onto the NSIS stack; not popping it corrupts the stack and can cause
;      later uninstall steps to misread values.  $0 is a scratch register and
;      the value is intentionally discarded.
;   3. ClearErrors after the exec — prevents a non-zero exit code from setting
;      the NSIS error flag that subsequent steps might check.
;   4. -ErrorAction SilentlyContinue inside the PowerShell command — the keys
;      simply won't exist if the user never enabled shell integration.
!macro un.customUnInstall
  ClearErrors
  DetailPrint "Removing AwapiCompare Explorer context menu entries (best-effort)..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \
    "Remove-Item -Path ''HKCU:\Software\Classes\*\shell\AwapiCompare'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Classes\Directory\shell\AwapiCompare'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Classes\*\shell\AwapiCompareDoCompare'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Classes\*\shell\AwapiCompareSetLeft'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Classes\Directory\shell\AwapiCompareDoCompare'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Classes\Directory\shell\AwapiCompareSetLeft'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell\AwapiCompare.SelectLeft'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell\AwapiCompare.ComparePending'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell\AwapiCompare.CompareTwo'' -Recurse -Force -ErrorAction SilentlyContinue; \
    Remove-Item -Path ''HKCU:\Software\Classes\CLSID\{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A10}'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Classes\CLSID\{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Classes\CLSID\{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Classes\CLSID\{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}'' -Recurse -Force -ErrorAction SilentlyContinue; \
     Remove-Item -Path ''HKCU:\Software\Awapi\AwapiCompare'' -Recurse -Force -ErrorAction SilentlyContinue"'
  Pop $0      ; discard exit code — cleanup is best-effort, never block uninstall
  ClearErrors
!macroend
