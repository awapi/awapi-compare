//! `IShellExtInit` + `IContextMenu` implementation.
//!
//! ## How it works
//!
//! 1. Explorer calls `IShellExtInit::Initialize` with an `IDataObject` that
//!    contains all selected items (via the `CF_HDROP` clipboard format).
//!    We store the paths in `state`.
//!
//! 2. Explorer calls `IContextMenu::QueryContextMenu`. We inspect the stored
//!    paths: if exactly two items were selected and they are the same kind
//!    (both files *or* both directories), we add one menu item — "Compare
//!    with AwapiCompare".  Otherwise we add nothing.
//!
//! 3. When the user clicks our item, Explorer calls `IContextMenu::InvokeCommand`.
//!    We look up the EXE path from the registry key written by the installer /
//!    registration script, then launch:
//!
//!        AwapiCompare.exe --left "<path1>" --right "<path2>"
//!
//!    The existing CLI parser (`cliArgs.ts`) already handles `--left` / `--right`.

use std::sync::Mutex;

use windows::core::{implement, Error, Result, HRESULT, PCWSTR, PSTR};
use windows::Win32::Foundation::{E_FAIL, E_INVALIDARG, E_NOTIMPL, TRUE};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, GetDC,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{
    IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL,
};
use windows::Win32::System::Ole::ReleaseStgMedium;
use windows::Win32::System::Registry::HKEY;
use windows::Win32::UI::Shell::{
    DragQueryFileW, ExtractIconExW, HDROP, IContextMenu, IContextMenu_Impl,
    IShellExtInit, IShellExtInit_Impl, CMINVOKECOMMANDINFO,
    CMF_DEFAULTONLY,
};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, DI_NORMAL, HICON,
    InsertMenuItemW, HMENU, MENUITEMINFOW,
    MIIM_BITMAP, MIIM_FTYPE, MIIM_ID, MIIM_STRING, MFT_STRING,
};

use crate::util::{get_exe_path, is_directory, launch_awapi};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Command offset for the "Compare" verb (0 = first / only item we add).
const CMD_COMPARE: u32 = 0;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

struct State {
    /// Paths extracted from the `IDataObject` during `Initialize`.
    paths: Vec<String>,
    /// Cached icon bitmap for the menu item. 0 = not yet attempted,
    /// -1 = failed, any other value = HBITMAP raw handle (isize).
    /// Stored as isize so `State` is `Send` (HBITMAP is a raw pointer).
    icon_bmp: isize,
}

// ---------------------------------------------------------------------------
// ContextMenuHandler
// ---------------------------------------------------------------------------

#[implement(IShellExtInit, IContextMenu)]
pub(crate) struct ContextMenuHandler {
    state: Mutex<State>,
}

impl ContextMenuHandler {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(State { paths: Vec::new(), icon_bmp: 0 }),
        }
    }
}

// ---------------------------------------------------------------------------
// IShellExtInit
// ---------------------------------------------------------------------------

#[allow(non_snake_case)]
impl IShellExtInit_Impl for ContextMenuHandler_Impl {
    fn Initialize(
        &self,
        _pidlfolder: *const ITEMIDLIST,
        pdtobj: Option<&IDataObject>,
        _hkeyprogid: HKEY,
    ) -> Result<()> {
        let Some(data_obj) = pdtobj else {
            return Ok(());
        };

        // CF_HDROP = 15 (standard Windows clipboard format for dropped files)
        let format_etc = FORMATETC {
            cfFormat: 15, // CF_HDROP
            ptd: core::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0 as u32,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };

        unsafe {
            let mut medium = data_obj.GetData(&format_etc)?;

            let hdrop = HDROP(medium.u.hGlobal.0);
            // 0xFFFFFFFF as the file index returns the total count.
            let count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);

            let mut paths = self.state.lock().unwrap_or_else(|e| e.into_inner());
            paths.paths.clear();

            for i in 0..count {
                // First call: get required buffer length (excluding NUL).
                let len = DragQueryFileW(hdrop, i, None) as usize;
                if len == 0 {
                    continue;
                }
                let mut buf = vec![0u16; len + 1];
                DragQueryFileW(hdrop, i, Some(&mut buf));
                let path = String::from_utf16_lossy(&buf[..len]);
                paths.paths.push(path);
            }

            ReleaseStgMedium(&mut medium);
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// IContextMenu
// ---------------------------------------------------------------------------

#[allow(non_snake_case)]
impl IContextMenu_Impl for ContextMenuHandler_Impl {
    /// Add "Compare with AwapiCompare" when exactly two compatible items are
    /// selected.  Returns `MAKE_HRESULT(0, 0, count)` — encoded as a
    /// "successful" non-S_OK HRESULT via the `Err` variant so the vtable
    /// adapter returns the right value (see comment below).
    fn QueryContextMenu(
        &self,
        hmenu: HMENU,
        indexmenu: u32,
        idcmdfirst: u32,
        _idcmdlast: u32,
        uflags: u32,
    ) -> Result<()> {
        // Skip when only the default item should be shown.
        if uflags & CMF_DEFAULTONLY != 0 {
            // Return S_OK (0 items added).
            return Ok(());
        }

        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let paths = &state.paths;

        if paths.len() != 2 {
            return Ok(());
        }

        let is_dir_0 = is_directory(&paths[0]);
        let is_dir_1 = is_directory(&paths[1]);

        // Require both to be the same kind (file↔file or dir↔dir).
        if is_dir_0 != is_dir_1 {
            return Ok(());
        }

        // Load the icon bitmap lazily (once per handler instance).
        if state.icon_bmp == 0 {
            let bmp = get_exe_path()
                .and_then(|exe| unsafe { create_menu_icon(&exe) })
                .map(|h| h.0 as isize)
                .unwrap_or(-1);
            state.icon_bmp = bmp;
        }
        let icon_hbmp = if state.icon_bmp > 0 {
            HBITMAP(state.icon_bmp as *mut _)
        } else {
            HBITMAP(core::ptr::null_mut())
        };

        // Build the wide label string on the stack.
        let mut label: Vec<u16> = "Compare with AwapiCompare"
            .encode_utf16()
            .chain(core::iter::once(0u16))
            .collect();

        let fmask = if icon_hbmp.is_invalid() {
            MIIM_ID | MIIM_STRING | MIIM_FTYPE
        } else {
            MIIM_ID | MIIM_STRING | MIIM_FTYPE | MIIM_BITMAP
        };

        let mii = MENUITEMINFOW {
            cbSize: core::mem::size_of::<MENUITEMINFOW>() as u32,
            fMask: fmask,
            fType: MFT_STRING,
            wID: idcmdfirst + CMD_COMPARE,
            dwTypeData: windows::core::PWSTR(label.as_mut_ptr()),
            cch: (label.len() - 1) as u32,
            hbmpItem: icon_hbmp,
            ..Default::default()
        };

        unsafe {
            InsertMenuItemW(hmenu, indexmenu, TRUE, &mii)?;
        }

        // The IContextMenu::QueryContextMenu contract requires returning
        // MAKE_HRESULT(0, 0, <count>) — not S_OK(0) — to tell Explorer how
        // many command IDs were consumed.  windows-rs maps Err(e) → e.code()
        // in the generated vtable adapter, so we return HRESULT(1) via the
        // Err path.  HRESULT(1) == 0x00000001 == MAKE_HRESULT(SEVERITY_SUCCESS,
        // FACILITY_NULL, 1) which is a *success* HRESULT by Win32 convention.
        Err(Error::from(HRESULT(1i32)))
    }

    fn InvokeCommand(&self, pici: *const CMINVOKECOMMANDINFO) -> Result<()> {
        if pici.is_null() {
            return Err(Error::from(E_INVALIDARG));
        }

        unsafe {
            let info = &*pici;
            // When HIWORD(lpVerb) == 0 the LOWORD is the command-ID offset.
            let verb_val = info.lpVerb.as_ptr() as usize;
            if verb_val >> 16 != 0 {
                // String verb — we only handle integer IDs for now.
                return Err(Error::from(E_NOTIMPL));
            }
            let cmd_offset = (verb_val & 0xFFFF) as u32;
            if cmd_offset != CMD_COMPARE {
                return Err(Error::from(E_FAIL));
            }
        }

        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.paths.len() != 2 {
            return Err(Error::from(E_FAIL));
        }

        let exe = get_exe_path().ok_or_else(|| Error::from(E_FAIL))?;
        let compare_type = if is_directory(&state.paths[0]) { "folder" } else { "file" };
        let (left, right) = (&state.paths[0], &state.paths[1]);

        launch_awapi(&exe, &format!("--type {compare_type} --left \"{left}\" --right \"{right}\""))
    }

    fn GetCommandString(
        &self,
        idcmd: usize,
        _utype: u32,
        _preserved: *const u32,
        _pszname: PSTR,
        _cchmax: u32,
    ) -> Result<()> {
        if idcmd != CMD_COMPARE as usize {
            return Err(Error::from(E_INVALIDARG));
        }
        // Returning E_NOTIMPL is accepted by modern Explorer for
        // shell extensions that do not need canonical verb names.
        Err(Error::from(E_NOTIMPL))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Creates a 16×16 32bpp HBITMAP from the first icon embedded in the given EXE.
///
/// Returns `None` when the EXE has no icon or any GDI call fails.
/// The caller is responsible for calling `DeleteObject` on the returned bitmap
/// when it is no longer needed.
unsafe fn create_menu_icon(exe_path: &str) -> Option<HBITMAP> {
    const SIZE: i32 = 16;

    let wide: Vec<u16> = exe_path
        .encode_utf16()
        .chain(core::iter::once(0u16))
        .collect();

    // Extract the small (16×16) icon from the EXE at index 0.
    let mut small_icon = HICON::default();
    let extracted = ExtractIconExW(
        PCWSTR(wide.as_ptr()),
        0,
        None,
        Some(&mut small_icon),
        1,
    );
    if extracted == 0 || small_icon.is_invalid() {
        return None;
    }

    // Create a 32bpp top-down DIB section so the icon renders with full
    // alpha channel in modern Explorer (PARGB32 format).
    let screen_dc = GetDC(None);
    let mem_dc = CreateCompatibleDC(screen_dc);
    ReleaseDC(None, screen_dc);

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: core::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: SIZE,
            biHeight: -SIZE, // negative = top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0, // BI_RGB
            ..Default::default()
        },
        ..Default::default()
    };

    let mut bits = core::ptr::null_mut::<core::ffi::c_void>();
    let hbmp = match CreateDIBSection(mem_dc, &bmi, DIB_RGB_COLORS, &mut bits, None, 0) {
        Ok(h) => h,
        Err(_) => {
            let _ = DeleteDC(mem_dc);
            let _ = DestroyIcon(small_icon);
            return None;
        }
    };

    let old_obj = SelectObject(mem_dc, hbmp);
    let _ = DrawIconEx(mem_dc, 0, 0, small_icon, SIZE, SIZE, 0, None, DI_NORMAL);
    SelectObject(mem_dc, old_obj);

    let _ = DeleteDC(mem_dc);
    let _ = DestroyIcon(small_icon);

    Some(hbmp)
}
