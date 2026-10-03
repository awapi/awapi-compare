//! `IExplorerCommand` implementation — the Windows 11 **modern** context menu.
//!
//! ## Why a second handler?
//!
//! Windows 11's default (compact) right-click menu does NOT display classic
//! registry verbs (`HKCU\Software\Classes\...\shell\...`) or classic COM
//! `IContextMenu` handlers — those only appear under "Show more options".
//! The modern menu only surfaces `IExplorerCommand` handlers registered by a
//! package with identity (we use a *sparse* MSIX package whose external
//! location is the install directory — see `resources/msix/`).
//!
//! ## Menu shape (Beyond Compare style)
//!
//! A single cascaded "AwapiCompare" flyout whose subcommands show/hide based
//! on the current selection:
//!
//! | Selection                              | Visible subcommands                  |
//! |----------------------------------------|--------------------------------------|
//! | 1 file / 1 folder                      | "Select Left Side to Compare"        |
//! | 1 item + pending left pick exists      | + "Compare with \"<left name>\""     |
//! | 2 files or 2 folders                   | "Compare"                            |
//!
//! Invocations launch `AwapiCompare.exe` with the same CLI flags used by the
//! classic registry verbs (`--set-left`, `--compare-pending`,
//! `--type/--left/--right`), so the app-side flow is identical.

use std::sync::Mutex;

use windows::core::{implement, Error, Result, GUID, PWSTR};
use windows::Win32::Foundation::{BOOL, E_FAIL, E_INVALIDARG, E_NOTIMPL, S_FALSE};
use windows::Win32::System::Com::IBindCtx;
use windows::Win32::UI::Shell::{
    IEnumExplorerCommand, IEnumExplorerCommand_Impl, IExplorerCommand, IExplorerCommand_Impl,
    IShellItemArray, SHStrDupW, SIGDN_FILESYSPATH,
};

use crate::util::{base_name, get_exe_path, is_directory, launch_awapi, pending_left_path};

// EXPCMDSTATE / EXPCMDFLAGS values (shobjidl_core.h). Declared locally as
// plain u32 so they can be returned from GetState/GetFlags without wrapper
// type juggling across windows-rs versions.
const ECS_ENABLED: u32 = 0x0;
const ECS_HIDDEN: u32 = 0x8;
const ECF_DEFAULT: u32 = 0x0;
const ECF_HASSUBCOMMANDS: u32 = 0x1;

// ---------------------------------------------------------------------------
// Selection snapshot
// ---------------------------------------------------------------------------

/// What the user has selected, extracted from the `IShellItemArray` Explorer
/// passes to every `IExplorerCommand` method.
struct Selection {
    paths: Vec<String>,
}

impl Selection {
    fn from_items(items: Option<&IShellItemArray>) -> Self {
        let mut paths = Vec::new();
        if let Some(array) = items {
            unsafe {
                let count = array.GetCount().unwrap_or(0);
                for i in 0..count {
                    let Ok(item) = array.GetItemAt(i) else { continue };
                    let Ok(pw) = item.GetDisplayName(SIGDN_FILESYSPATH) else { continue };
                    if !pw.is_null() {
                        paths.push(pw.to_string().unwrap_or_default());
                        windows::Win32::System::Com::CoTaskMemFree(Some(pw.0 as *const _));
                    }
                }
            }
        }
        Selection { paths }
    }

    /// Two items of the same kind (file↔file or dir↔dir)?
    fn is_comparable_pair(&self) -> bool {
        self.paths.len() == 2 && is_directory(&self.paths[0]) == is_directory(&self.paths[1])
    }

    fn is_single(&self) -> bool {
        self.paths.len() == 1
    }
}

/// Allocates a COM string (CoTaskMem) from a Rust `&str` for PWSTR returns.
fn com_string(s: &str) -> Result<PWSTR> {
    let wide: Vec<u16> = s.encode_utf16().chain(core::iter::once(0)).collect();
    unsafe { SHStrDupW(windows::core::PCWSTR(wide.as_ptr())) }
}

/// `"<exe path>,0"` icon resource string, shared by all commands.
fn icon_resource() -> Result<PWSTR> {
    match get_exe_path() {
        Some(exe) => com_string(&format!("{exe},0")),
        None => Err(Error::from(E_NOTIMPL)),
    }
}

// ---------------------------------------------------------------------------
// Top-level flyout command
// ---------------------------------------------------------------------------

/// The top-level "AwapiCompare" entry in the Windows 11 modern menu.
/// Has no action of its own — it exposes the subcommands below.
#[implement(IExplorerCommand)]
pub(crate) struct ExplorerCommandHandler;

impl ExplorerCommandHandler {
    pub(crate) fn new() -> Self {
        Self
    }
}

#[allow(non_snake_case)]
impl IExplorerCommand_Impl for ExplorerCommandHandler_Impl {
    fn GetTitle(&self, _items: Option<&IShellItemArray>) -> Result<PWSTR> {
        com_string("AwapiCompare")
    }

    fn GetIcon(&self, _items: Option<&IShellItemArray>) -> Result<PWSTR> {
        icon_resource()
    }

    fn GetToolTip(&self, _items: Option<&IShellItemArray>) -> Result<PWSTR> {
        Err(Error::from(E_NOTIMPL))
    }

    fn GetCanonicalName(&self) -> Result<GUID> {
        Ok(crate::CLSID_AWAPI_EXPLORER_COMMAND)
    }

    fn GetState(&self, items: Option<&IShellItemArray>, _ok_to_be_slow: BOOL) -> Result<u32> {
        let sel = Selection::from_items(items);
        if sel.is_single() || sel.is_comparable_pair() {
            Ok(ECS_ENABLED)
        } else {
            Ok(ECS_HIDDEN)
        }
    }

    fn Invoke(&self, _items: Option<&IShellItemArray>, _pbc: Option<&IBindCtx>) -> Result<()> {
        // Never invoked directly: the flyout only hosts subcommands.
        Ok(())
    }

    fn GetFlags(&self) -> Result<u32> {
        Ok(ECF_HASSUBCOMMANDS)
    }

    fn EnumSubCommands(&self) -> Result<IEnumExplorerCommand> {
        let commands: Vec<IExplorerCommand> = vec![
            SubCommand::new(SubKind::SelectLeft).into(),
            SubCommand::new(SubKind::ComparePending).into(),
            SubCommand::new(SubKind::CompareTwo).into(),
        ];
        Ok(SubCommandEnum::new(commands).into())
    }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum SubKind {
    /// 1 item selected → remember it as the pending left side.
    SelectLeft,
    /// 1 item selected + a pending left exists → compare the two.
    ComparePending,
    /// 2 items of the same kind selected → compare them directly.
    CompareTwo,
}

#[implement(IExplorerCommand)]
struct SubCommand {
    kind: SubKind,
}

impl SubCommand {
    fn new(kind: SubKind) -> Self {
        Self { kind }
    }
}

#[allow(non_snake_case)]
impl IExplorerCommand_Impl for SubCommand_Impl {
    fn GetTitle(&self, _items: Option<&IShellItemArray>) -> Result<PWSTR> {
        match self.kind {
            SubKind::SelectLeft => com_string("Select Left Side to Compare"),
            SubKind::CompareTwo => com_string("Compare"),
            SubKind::ComparePending => {
                let left = pending_left_path().ok_or_else(|| Error::from(E_FAIL))?;
                com_string(&format!("Compare with \"{}\"", base_name(&left)))
            }
        }
    }

    fn GetIcon(&self, _items: Option<&IShellItemArray>) -> Result<PWSTR> {
        icon_resource()
    }

    fn GetToolTip(&self, _items: Option<&IShellItemArray>) -> Result<PWSTR> {
        Err(Error::from(E_NOTIMPL))
    }

    fn GetCanonicalName(&self) -> Result<GUID> {
        Ok(GUID::zeroed())
    }

    fn GetState(&self, items: Option<&IShellItemArray>, _ok_to_be_slow: BOOL) -> Result<u32> {
        let sel = Selection::from_items(items);
        let visible = match self.kind {
            SubKind::SelectLeft => sel.is_single(),
            SubKind::ComparePending => sel.is_single() && pending_left_path().is_some(),
            SubKind::CompareTwo => sel.is_comparable_pair(),
        };
        Ok(if visible { ECS_ENABLED } else { ECS_HIDDEN })
    }

    fn Invoke(&self, items: Option<&IShellItemArray>, _pbc: Option<&IBindCtx>) -> Result<()> {
        let sel = Selection::from_items(items);
        let exe = get_exe_path().ok_or_else(|| Error::from(E_FAIL))?;

        match self.kind {
            SubKind::SelectLeft => {
                let [path] = sel.paths.as_slice() else {
                    return Err(Error::from(E_INVALIDARG));
                };
                launch_awapi(&exe, &format!("--set-left \"{path}\""))
            }
            SubKind::ComparePending => {
                let [path] = sel.paths.as_slice() else {
                    return Err(Error::from(E_INVALIDARG));
                };
                launch_awapi(&exe, &format!("--compare-pending \"{path}\""))
            }
            SubKind::CompareTwo => {
                let [left, right] = sel.paths.as_slice() else {
                    return Err(Error::from(E_INVALIDARG));
                };
                let compare_type = if is_directory(left) { "folder" } else { "file" };
                launch_awapi(
                    &exe,
                    &format!("--type {compare_type} --left \"{left}\" --right \"{right}\""),
                )
            }
        }
    }

    fn GetFlags(&self) -> Result<u32> {
        Ok(ECF_DEFAULT)
    }

    fn EnumSubCommands(&self) -> Result<IEnumExplorerCommand> {
        Err(Error::from(E_NOTIMPL))
    }
}

// ---------------------------------------------------------------------------
// IEnumExplorerCommand
// ---------------------------------------------------------------------------

#[implement(IEnumExplorerCommand)]
struct SubCommandEnum {
    commands: Vec<IExplorerCommand>,
    index: Mutex<usize>,
}

impl SubCommandEnum {
    fn new(commands: Vec<IExplorerCommand>) -> Self {
        Self { commands, index: Mutex::new(0) }
    }
}

#[allow(non_snake_case)]
impl IEnumExplorerCommand_Impl for SubCommandEnum_Impl {
    fn Next(
        &self,
        celt: u32,
        pucmd: *mut Option<IExplorerCommand>,
        pceltfetched: *mut u32,
    ) -> windows::core::HRESULT {
        if pucmd.is_null() {
            return E_INVALIDARG.into();
        }
        let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
        let mut fetched: u32 = 0;

        unsafe {
            for slot in 0..celt as usize {
                if *index >= self.commands.len() {
                    break;
                }
                *pucmd.add(slot) = Some(self.commands[*index].clone());
                *index += 1;
                fetched += 1;
            }
            if !pceltfetched.is_null() {
                *pceltfetched = fetched;
            }
        }

        if fetched == celt {
            windows::core::HRESULT(0) // S_OK
        } else {
            S_FALSE
        }
    }

    fn Skip(&self, celt: u32) -> Result<()> {
        let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
        *index = (*index + celt as usize).min(self.commands.len());
        Ok(())
    }

    fn Reset(&self) -> Result<()> {
        *self.index.lock().unwrap_or_else(|e| e.into_inner()) = 0;
        Ok(())
    }

    fn Clone(&self) -> Result<IEnumExplorerCommand> {
        Ok(SubCommandEnum::new(self.commands.clone()).into())
    }
}
