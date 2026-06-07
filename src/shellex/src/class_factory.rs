//! `IClassFactory` implementation.
//!
//! Creates a new `ContextMenuHandler` instance on demand and lets Explorer
//! query it for `IShellExtInit` / `IContextMenu`.

use windows::core::{implement, Interface, Result};
use windows::Win32::Foundation::{BOOL, CLASS_E_NOAGGREGATION};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};
use windows::Win32::UI::Shell::IShellExtInit;

use crate::context_menu::ContextMenuHandler;

#[implement(IClassFactory)]
pub(crate) struct ClassFactory;

impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Option<&windows::core::IUnknown>,
        riid: *const windows::core::GUID,
        ppvobject: *mut *mut core::ffi::c_void,
    ) -> Result<()> {
        // Aggregation is not supported.
        if punkouter.is_some() {
            return Err(windows::core::Error::from(CLASS_E_NOAGGREGATION));
        }

        // The #[implement] macro on ContextMenuHandler makes it convertible
        // to any of its implemented interfaces.  We convert to IShellExtInit
        // (which derefs to IUnknown) so that QueryInterface can select
        // whichever interface the caller actually requested.
        let handler: IShellExtInit = ContextMenuHandler::new().into();
        unsafe { handler.query(riid, ppvobject).ok() }
    }

    fn LockServer(&self, _flock: BOOL) -> Result<()> {
        // Not tracking server lock counts; harmless for a per-user extension.
        Ok(())
    }
}
