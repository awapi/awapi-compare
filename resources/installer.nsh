; Custom NSIS macros included by electron-builder.
;
; All registry writes target HKCU (per-user). No elevation required.
; ${APP_EXECUTABLE_FILENAME} is injected by electron-builder (e.g. "AwapiCompare.exe").
; $INSTDIR is the runtime install directory chosen by the user.

; CLSID for awapi_shellex.dll — must match SHELLEX_CLSID in shellIntegrationService.ts
; and the CLSID_AWAPI_CONTEXT_MENU constant in src/shellex/src/lib.rs.
!define AWAPI_SHELLEX_CLSID "{6814CA76-731B-41EC-948C-C320FB503A35}"

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

  WriteRegStr HKCU "Software\Classes\CLSID\${AWAPI_SHELLEX_CLSID}\InprocServer32" "" "$INSTDIR\awapi_shellex.dll"
  WriteRegStr HKCU "Software\Classes\CLSID\${AWAPI_SHELLEX_CLSID}\InprocServer32" "ThreadingModel" "Apartment"

  ; Register extension handler for files, directories, and the directory background.
  WriteRegStr HKCU "Software\Classes\*\shellex\ContextMenuHandlers\AwapiCompare" "" "${AWAPI_SHELLEX_CLSID}"
  WriteRegStr HKCU "Software\Classes\Directory\shellex\ContextMenuHandlers\AwapiCompare" "" "${AWAPI_SHELLEX_CLSID}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shellex\ContextMenuHandlers\AwapiCompare" "" "${AWAPI_SHELLEX_CLSID}"

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
!macroend

!macro un.customInstall
!macroend

!macro un.customUnInstall
!macroend
