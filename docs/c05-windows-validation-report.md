# C0.5 Windows Validation Report

## Automated Checks

Validator status: **PASS**

| Tool         | Value                             |
| ------------ | --------------------------------- |
| OS           | Microsoft Windows NT 10.0.26200.0 |
| Timestamp    | 2026-06-18 22:22:54-04:00         |
| cmake        | cmake version 4.3.3               |
| cl.exe       | <missing>                         |
| regsvr32.exe | C:\WINDOWS\system32\regsvr32.exe  |
| signtool.exe | <missing>                         |

### Validator Output

```text
[PASS] DLL exists :: C:\projects\github.awapi\awapi-compare\src\shell-ext-win\build\Release\AwapiCompareShellExt.dll
[PASS] CommandStore key exists (AwapiCompare.CompareTwo) :: HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell\AwapiCompare.CompareTwo
[PASS] ExplorerCommandHandler bound (AwapiCompare.CompareTwo) :: expected={7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11} actual={7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}
[PASS] CLSID InprocServer32 exists ({7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}) :: HKCU:\Software\Classes\CLSID\{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}\InprocServer32
[PASS] CLSID DLL path matches ({7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}) :: expected=C:\projects\github.awapi\awapi-compare\src\shell-ext-win\build\Release\AwapiCompareShellExt.dll actual=C:\projects\github.awapi\awapi-compare\src\shell-ext-win\build\Release\AwapiCompareShellExt.dll
[PASS] ThreadingModel Apartment ({7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}) :: actual=Apartment
[PASS] CommandStore key exists (AwapiCompare.SelectLeft) :: HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell\AwapiCompare.SelectLeft
[PASS] ExplorerCommandHandler bound (AwapiCompare.SelectLeft) :: expected={7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12} actual={7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}
[PASS] CLSID InprocServer32 exists ({7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}) :: HKCU:\Software\Classes\CLSID\{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}\InprocServer32
[PASS] CLSID DLL path matches ({7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}) :: expected=C:\projects\github.awapi\awapi-compare\src\shell-ext-win\build\Release\AwapiCompareShellExt.dll actual=C:\projects\github.awapi\awapi-compare\src\shell-ext-win\build\Release\AwapiCompareShellExt.dll
[PASS] ThreadingModel Apartment ({7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}) :: actual=Apartment
[PASS] CommandStore key exists (AwapiCompare.ComparePending) :: HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell\AwapiCompare.ComparePending
[PASS] ExplorerCommandHandler bound (AwapiCompare.ComparePending) :: expected={7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13} actual={7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}
[PASS] CLSID InprocServer32 exists ({7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}) :: HKCU:\Software\Classes\CLSID\{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}\InprocServer32
[PASS] CLSID DLL path matches ({7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}) :: expected=C:\projects\github.awapi\awapi-compare\src\shell-ext-win\build\Release\AwapiCompareShellExt.dll actual=C:\projects\github.awapi\awapi-compare\src\shell-ext-win\build\Release\AwapiCompareShellExt.dll
[PASS] ThreadingModel Apartment ({7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}) :: actual=Apartment
[PASS] Awapi config key exists :: HKCU:\Software\Awapi\AwapiCompare
[PASS] ExePath configured :: ExePath=C:\projects\github.awapi\awapi-compare\release\win-arm64-unpacked\AwapiCompare.exe
[PASS] PendingLeftPath configured :: PendingLeftPath=C:\Users\Omer\AppData\Roaming\AwapiCompare\pending-left.txt
Shell extension validation succeeded.
```

## Manual Explorer Runtime Checklist

- [ ] Build native DLL (`just shellext`) completed on this machine.
- [ ] Run app shell registration (`AwapiCompare.exe --register-shell`).
- [ ] Restart Explorer (`taskkill /f /im explorer.exe`, then `start explorer.exe`).
- [ ] Right-click exactly 2 files: **Compare with AwapiCompare** launches file compare tab.
- [ ] Right-click exactly 2 folders: **Compare with AwapiCompare** launches folder compare tab.
- [ ] Right-click one item: **Select Left Side for Compare** appears and works.
- [ ] Right-click second item later: **Compare to <left>** label appears and works.
- [ ] Mixed file+folder selection does not open a broken compare tab.
- [ ] Temporarily move/rename app exe: Explorer verbs hide or fail safely (no Explorer crash).
- [ ] Unregister shell (`AwapiCompare.exe --unregister-shell`) removes entries.

## Windows 11 Compact Menu Gate

- [ ] Sparse MSIX package prepared with FileExplorerContextMenus declaration.
- [ ] Package signed with production identity.
- [ ] Verbs appear in modern compact context menu (not only Show more options).

## Notes

- Keep C0.5 unchecked until all required runtime gates above are complete.
- This report captures both automated registry validation and manual Explorer outcomes.
