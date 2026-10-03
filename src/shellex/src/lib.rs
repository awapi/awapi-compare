//! DLL entry points and COM class registration.
//!
//! The shell extension DLL exports:
//!   - `DllMain`           — stores the module HMODULE at load time
//!   - `DllGetClassObject` — returns our IClassFactory for CLSID_AWAPI_CONTEXT_MENU
//!   - `DllCanUnloadNow`   — always returns S_FALSE (let Explorer manage lifetime)
//!
//! Registration is performed by the installer / PowerShell script, NOT by
//! `DllRegisterServer`, because we target HKCU (no elevation needed).

mod class_factory;
mod context_menu;
mod explorer_command;
mod util;

use std::sync::atomic::{AtomicIsize, Ordering};

use windows::core::{GUID, HRESULT, Interface};
use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, E_POINTER, HMODULE, S_FALSE};
use windows::Win32::System::Com::IClassFactory;

/// CLSID for the AwapiCompare context-menu shell extension.
///
/// `{6814CA76-731B-41EC-948C-C320FB503A35}`
///
/// Registered under:
///   HKCU\Software\Classes\CLSID\{6814CA76-…}\InprocServer32
///   HKCU\Software\Classes\*\shellex\ContextMenuHandlers\AwapiCompare
///   HKCU\Software\Classes\Directory\shellex\ContextMenuHandlers\AwapiCompare
pub(crate) const CLSID_AWAPI_CONTEXT_MENU: GUID = GUID {
    data1: 0x6814_CA76,
    data2: 0x731B,
    data3: 0x41EC,
    data4: [0x94, 0x8C, 0xC3, 0x20, 0xFB, 0x50, 0x3A, 0x35],
};

/// CLSID for the Windows 11 modern-menu `IExplorerCommand` handler.
///
/// `{EA2B6EB9-EDC9-4804-8086-9138D268CE9A}`
///
/// Referenced by the sparse-package manifest (`resources/msix/AppxManifest.template.xml`)
/// `desktop5:Verb Clsid=...` and its `com:SurrogateServer` class registration.
/// Must stay in sync with `SHELLEX_EXPLORER_COMMAND_CLSID` in
/// `shellIntegrationService.ts`.
pub(crate) const CLSID_AWAPI_EXPLORER_COMMAND: GUID = GUID {
    data1: 0xEA2B_6EB9,
    data2: 0xEDC9,
    data3: 0x4804,
    data4: [0x80, 0x86, 0x91, 0x38, 0xD2, 0x68, 0xCE, 0x9A],
};

/// Cached HMODULE set by DllMain (kept for diagnostics / future use).
static DLL_MODULE: AtomicIsize = AtomicIsize::new(0);

// ---------------------------------------------------------------------------
// DLL entry points
// ---------------------------------------------------------------------------

#[no_mangle]
extern "system" fn DllMain(
    hmodule: HMODULE,
    dw_reason: u32,
    _lp_reserved: *mut core::ffi::c_void,
) -> bool {
    if dw_reason == 1 /* DLL_PROCESS_ATTACH */ {
        DLL_MODULE.store(hmodule.0 as isize, Ordering::Relaxed);
    }
    true
}

/// Returns our `IClassFactory` for either of the two handler CLSIDs:
/// the classic `IContextMenu` handler or the Win11 `IExplorerCommand` handler.
#[no_mangle]
unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut core::ffi::c_void,
) -> HRESULT {
    if rclsid.is_null() || riid.is_null() || ppv.is_null() {
        return E_POINTER;
    }

    let kind = if *rclsid == CLSID_AWAPI_CONTEXT_MENU {
        class_factory::HandlerKind::ContextMenu
    } else if *rclsid == CLSID_AWAPI_EXPLORER_COMMAND {
        class_factory::HandlerKind::ExplorerCommand
    } else {
        return CLASS_E_CLASSNOTAVAILABLE;
    };

    let factory: IClassFactory = class_factory::ClassFactory::new(kind).into();
    factory.query(riid, ppv)
}

/// Returns `S_FALSE` — Explorer is responsible for managing the DLL lifetime.
#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}
