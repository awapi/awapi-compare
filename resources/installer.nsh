; Custom NSIS macros included by electron-builder.
; electron-builder calls these four macros at the appropriate install/uninstall
; phases. Only the un.customUnInstall macro is used here — it removes the
; AwapiCompare Windows Explorer context menu registry keys that were written by
; the in-app "Enable Explorer Integration" feature.

; ---- Install phase (no-op) ------------------------------------------------
!macro customInstall
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
     Remove-Item -Path ''HKCU:\Software\Classes\Directory\shell\AwapiCompare'' -Recurse -Force -ErrorAction SilentlyContinue"'
  Pop $0      ; discard exit code — cleanup is best-effort, never block uninstall
  ClearErrors
!macroend
