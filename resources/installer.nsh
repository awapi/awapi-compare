; Custom NSIS macros included by electron-builder.
;
; All registry writes target HKCU (per-user). No elevation required.
; ${APP_EXECUTABLE_FILENAME} is injected by electron-builder (e.g. "AwapiCompare.exe").
; $INSTDIR is the runtime install directory chosen by the user.

; CLSID for awapi_shellex.dll — must match SHELLEX_CLSID in shellIntegrationService.ts
; and the CLSID_AWAPI_CONTEXT_MENU constant in src/shellex/src/lib.rs.
!define AWAPI_SHELLEX_CLSID "{6814CA76-731B-41EC-948C-C320FB503A35}"

; Must match SPARSE_PACKAGE_NAME / SHELL_INTEGRATION_VERSION in shellIntegrationService.ts.
!define AWAPI_SPARSE_PACKAGE "Awapi.AwapiCompare"
!define AWAPI_SHELL_INTEGRATION_VERSION "2"

; The NSIS installer is a 32-bit process, so plain "powershell.exe" would be
; the WOW64 (SysWOW64) one, where the Appx cmdlets are unreliable. Use the
; native PowerShell via Sysnative when it exists.
!macro AwapiFindPowerShell outVar
  StrCpy ${outVar} "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy ${outVar} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
!macroend

; ---- Install phase --------------------------------------------------------
!macro customInstall
  DetailPrint "Registering AwapiCompare Explorer context menu entries..."

  ; NOTE: Each WriteRegStr MUST be on a single line (no NSIS line continuation).
  ; See the original comment in this file for the reason.

  ; ---- Store EXE path for the COM DLL to read at invocation time ----------
  WriteRegStr HKCU "Software\AwapiCompare" "ExePath" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  ; ---- Single-selection registry verbs ------------------------------------
  ; MultiSelectModel=Single hides these verbs when 2+ items are selected.
  ; The COM shell extension handles multi-select instead.

  ; Directory verbs (right-click on a folder)
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareSetLeft" "" "Select Left Side for AwapiCompare"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareSetLeft" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareSetLeft" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareSetLeft\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --set-left "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareDoCompare" "" "Compare with AwapiCompare"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareDoCompare" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareDoCompare" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareDoCompare\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --compare-pending "%1"'

  ; * verbs (right-click on a file)
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareSetLeft" "" "Select Left Side for AwapiCompare"
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareSetLeft" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareSetLeft" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareSetLeft\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --set-left "%1"'

  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareDoCompare" "" "Compare with AwapiCompare"
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareDoCompare" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareDoCompare" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareDoCompare\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --compare-pending "%1"'

  ; ---- COM shell extension (multi-select: right-click 2 items → Compare) --
  ; awapi_shellex.dll implements IShellExtInit + IContextMenu.
  ; It shows "Compare with AwapiCompare" when exactly 2 files OR 2 folders
  ; are selected, then launches:  AwapiCompare.exe --left <p1> --right <p2>
  ;
  ; Both arches ship in $INSTDIR\shellex\{x64,arm64}\. Explorer only loads a
  ; DLL of its own architecture and an x64 installer is often run on ARM64,
  ; so register the OS's native one ($R1). This key is not WOW64-redirected.
  Push $R0
  Push $R1
  Push $R2
  ReadRegStr $R0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "PROCESSOR_ARCHITECTURE"
  ${If} $R0 == "ARM64"
    StrCpy $R1 "arm64"
  ${Else}
    StrCpy $R1 "x64"
  ${EndIf}

  WriteRegStr HKCU "Software\Classes\CLSID\${AWAPI_SHELLEX_CLSID}\InprocServer32" "" "$INSTDIR\shellex\$R1\awapi_shellex.dll"
  WriteRegStr HKCU "Software\Classes\CLSID\${AWAPI_SHELLEX_CLSID}\InprocServer32" "ThreadingModel" "Apartment"

  ; Register extension handler for files, directories, and the directory background.
  WriteRegStr HKCU "Software\Classes\*\shellex\ContextMenuHandlers\AwapiCompare" "" "${AWAPI_SHELLEX_CLSID}"
  WriteRegStr HKCU "Software\Classes\Directory\shellex\ContextMenuHandlers\AwapiCompare" "" "${AWAPI_SHELLEX_CLSID}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shellex\ContextMenuHandlers\AwapiCompare" "" "${AWAPI_SHELLEX_CLSID}"

  ; ---- Windows 11 sparse package (modern, compact context menu) -----------
  ; Unsigned sparse package whose IExplorerCommand handler lives in the DLL
  ; above (-ExternalLocation = install dir). Per-user; no admin, certificate
  ; or Developer Mode needed. Skipped on Windows 10 (build < 22000).
  DetailPrint "Registering AwapiCompare Windows 11 context menu..."
  !insertmacro AwapiFindPowerShell $R2
  nsExec::ExecToLog `"$R2" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if ([Environment]::OSVersion.Version.Build -lt 22000) { exit 0 }; Get-AppxPackage -Name ${AWAPI_SPARSE_PACKAGE} | Remove-AppxPackage -ErrorAction SilentlyContinue; Add-AppxPackage -Path '$INSTDIR\shellex\$R1\awapi_shellex.msix' -ExternalLocation '$INSTDIR' -AllowUnsigned -ErrorAction Stop"`
  Pop $R0
  ; On success mark integration complete so the app skips its first-launch
  ; self-registration; on failure leave it unset so the app retries.
  ${If} $R0 == "0"
    WriteRegStr HKCU "Software\AwapiCompare" "ShellIntegrationVersion" "${AWAPI_SHELL_INTEGRATION_VERSION}"
  ${Else}
    DetailPrint "Windows 11 context menu registration failed ($R0); the app will retry on launch."
  ${EndIf}
  Pop $R2
  Pop $R1
  Pop $R0

  ; ---- Send To shortcut (convenience: drag-compare or keyboard shortcut) --
  DetailPrint "Creating AwapiCompare Send To shortcut..."
  CreateShortcut "$SENDTO\AwapiCompare.lnk" \
    "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" \
    "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

; ---- Uninstall phase ------------------------------------------------------
!macro customUnInstall
  DetailPrint "Removing AwapiCompare Explorer context menu entries..."

  ; Single-selection registry verbs (current flat layout).
  DeleteRegKey HKCU "Software\Classes\Directory\shell\AwapiCompareSetLeft"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\AwapiCompareDoCompare"
  DeleteRegKey HKCU "Software\Classes\*\shell\AwapiCompareSetLeft"
  DeleteRegKey HKCU "Software\Classes\*\shell\AwapiCompareDoCompare"

  ; Legacy cascading layout (pre-flat builds) - best effort.
  DeleteRegKey HKCU "Software\Classes\Directory\shell\AwapiCompare"
  DeleteRegKey HKCU "Software\Classes\*\shell\AwapiCompare"

  ; COM shell extension.
  DeleteRegKey HKCU "Software\Classes\CLSID\${AWAPI_SHELLEX_CLSID}"
  DeleteRegKey HKCU "Software\Classes\*\shellex\ContextMenuHandlers\AwapiCompare"
  DeleteRegKey HKCU "Software\Classes\Directory\shellex\ContextMenuHandlers\AwapiCompare"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shellex\ContextMenuHandlers\AwapiCompare"

  ; Stored EXE path and Send To shortcut.
  DeleteRegKey HKCU "Software\AwapiCompare"
  Delete "$SENDTO\AwapiCompare.lnk"

  ; Windows 11 sparse package (modern context menu).
  Push $R2
  !insertmacro AwapiFindPowerShell $R2
  nsExec::ExecToLog `"$R2" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-AppxPackage -Name ${AWAPI_SPARSE_PACKAGE} | Remove-AppxPackage -ErrorAction SilentlyContinue"`
  Pop $R2 ; exit code
  Pop $R2
!macroend

!macro un.customInstall
!macroend

!macro un.customUnInstall
!macroend
