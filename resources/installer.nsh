; Custom NSIS macros included by electron-builder.
;
; All registry writes target HKCU (per-user). No elevation required.
; ${APP_EXECUTABLE_FILENAME} is injected by electron-builder (e.g. "AwapiCompare.exe").
; $INSTDIR is the runtime install directory chosen by the user.

; ---- Install phase --------------------------------------------------------
; Write two flat context-menu verbs for folders (Directory) and files (*).
; Inline - no helper macros - to avoid NSIS nested-macro expansion issues.
; Also create a "Send to" shortcut for multi-select (2-folder) compares.
!macro customInstall
  DetailPrint "Registering AwapiCompare Explorer context menu entries..."

  ; NOTE: Each WriteRegStr MUST be on a single line. NSIS line continuations
  ; (\) inside this file were observed to silently corrupt the writes when
  ; the file is processed through electron-builder's include - the (default)
  ; value ended up empty and the \command subkey was never created, leaving
  ; Explorer with a verb but no command to execute.

  ; --- Directory verbs (right-click on a folder) ---

  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareSetLeft" "" "Select Left Side for AwapiCompare"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareSetLeft" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareSetLeft\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --set-left "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareDoCompare" "" "Compare with AwapiCompare"
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareDoCompare" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\AwapiCompareDoCompare\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --compare-pending "%1"'

  ; --- * verbs (right-click on a file) ---

  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareSetLeft" "" "Select Left Side for AwapiCompare"
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareSetLeft" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareSetLeft\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --set-left "%1"'

  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareDoCompare" "" "Compare with AwapiCompare"
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareDoCompare" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\*\shell\AwapiCompareDoCompare\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --compare-pending "%1"'

  ; --- Send to shortcut (enables 2-item multi-select compare) ---
  ; Selecting 2 folders -> Send to -> AwapiCompare passes both paths as argv.
  DetailPrint "Creating AwapiCompare Send To shortcut..."
  CreateShortcut "$SENDTO\AwapiCompare.lnk" \
    "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" \
    "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
!macroend

!macro un.customInstall
!macroend

; ---- Uninstall phase ------------------------------------------------------
!macro un.customUnInstall
  DetailPrint "Removing AwapiCompare Explorer context menu entries..."

  ; New flat layout (current).
  DeleteRegKey HKCU "Software\Classes\Directory\shell\AwapiCompareSetLeft"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\AwapiCompareDoCompare"
  DeleteRegKey HKCU "Software\Classes\*\shell\AwapiCompareSetLeft"
  DeleteRegKey HKCU "Software\Classes\*\shell\AwapiCompareDoCompare"

  ; Legacy cascading layout (pre-flat builds) - best effort.
  DeleteRegKey HKCU "Software\Classes\Directory\shell\AwapiCompare"
  DeleteRegKey HKCU "Software\Classes\*\shell\AwapiCompare"

  ; Remove Send to shortcut.
  Delete "$SENDTO\AwapiCompare.lnk"
!macroend
