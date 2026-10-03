//! `IClassFactory` implementation.
//!
//! One factory serves both registered CLSIDs: it creates either the classic
//! `ContextMenuHandler` (`IShellExtInit`/`IContextMenu`) or the Windows 11
//! modern-menu `ExplorerCommandHandler` (`IExplorerCommand`) depending on
//! which CLSID Explorer asked `DllGetClassObject` for.

use windows::core::{implement, Interface, Result};
use windows::Win32::Foundation::{BOOL, CLASS_E_NOAGGREGATION};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl};
use windows::Win32::UI::Shell::{IExplorerCommand, IShellExtInit};

use crate::context_menu::ContextMenuHandler;
use crate::explorer_command::ExplorerCommandHandler;

/// Which COM object this factory instantiates.
#[derive(Clone, Copy)]
pub(crate) enum HandlerKind {
    ContextMenu,
    ExplorerCommand,
}

#[implement(IClassFactory)]
pub(crate) struct ClassFactory {
    kind: HandlerKind,
}

impl ClassFactory {
    pub(crate) fn new(kind: HandlerKind) -> Self {
        Self { kind }
    }
}

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

        // The #[implement] macro makes each handler convertible to any of its
        // implemented interfaces (which deref to IUnknown), so QueryInterface
        // can select whichever interface the caller actually requested.
        match self.kind {
            HandlerKind::ContextMenu => {
                let handler: IShellExtInit = ContextMenuHandler::new().into();
                unsafe { handler.query(riid, ppvobject).ok() }
            }
            HandlerKind::ExplorerCommand => {
                let handler: IExplorerCommand = ExplorerCommandHandler::new().into();
                unsafe { handler.query(riid, ppvobject).ok() }
            }
        }
    }

    fn LockServer(&self, _flock: BOOL) -> Result<()> {
        // Not tracking server lock counts; harmless for a per-user extension.
        Ok(())
    }
}
