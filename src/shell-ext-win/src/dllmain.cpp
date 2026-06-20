// AwapiCompare — Windows Explorer command handler (IExplorerCommand).
//
// This in-process COM server exposes three Explorer verbs that drive the same
// CLI contract as the rest of the app:
//
//   CompareTwo      → "<exe>" --compare-two "<a>" "<b>"   (multi-select, 2 items)
//   SelectLeft      → "<exe>" --set-left "<path>"         (single item)
//   ComparePending  → "<exe>" --compare-pending "<path>"  (single item; dynamic
//                                                           "Compare to <left>")
//
// Why a native handler at all (vs. the plain CommandStore `command` subkeys)?
//   * Multi-select: an IExplorerCommand receives the full IShellItemArray, so
//     "right-click two items → compare" works in a single click. The legacy
//     `command` verb can only receive one path (%1) per invocation.
//   * Modern menu: Windows 11's compact context menu only surfaces verbs that
//     are backed by an IExplorerCommand handler (when shipped in a package).
//   * Dynamic labels: GetTitle() can show "Compare to readme.txt" once a left
//     side has been picked.
//
// Robustness contract (acceptance criterion #4 — never crash Explorer):
//   * Every entry point is wrapped so failures degrade to "hidden/disabled"
//     rather than throwing. If the app exe cannot be located the verbs hide
//     themselves, and Explorer still has the `command` subkeys as a fallback.
//
// The handler reads its configuration from the registry (written by
// ShellIntegrationService.register):
//   HKCU\Software\Awapi\AwapiCompare\ExePath          → app executable
//   HKCU\Software\Awapi\AwapiCompare\PendingLeftPath  → pending-left.txt path

#include <windows.h>

#include <shlobj.h>
#include <shobjidl_core.h>
#include <shlwapi.h>
#include <strsafe.h>

#include <initguid.h>

#include <new>
#include <string>

#include "guids.h"

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

namespace {

HMODULE g_hModule = nullptr;
long g_cDllRef = 0;

constexpr wchar_t kConfigKey[] = L"Software\\Awapi\\AwapiCompare";

void DllAddRef() noexcept { InterlockedIncrement(&g_cDllRef); }
void DllRelease() noexcept { InterlockedDecrement(&g_cDllRef); }

// ---------------------------------------------------------------------------
// Small helpers — all best-effort, never throw across the COM boundary.
// ---------------------------------------------------------------------------

// Reads a single string value from HKCU\Software\Awapi\AwapiCompare.
std::wstring ReadConfigValue(const wchar_t* valueName) {
  std::wstring result;
  HKEY hKey = nullptr;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, kConfigKey, 0, KEY_QUERY_VALUE, &hKey) !=
      ERROR_SUCCESS) {
    return result;
  }
  wchar_t buffer[MAX_PATH * 2] = {};
  DWORD cb = sizeof(buffer);
  DWORD type = 0;
  if (RegQueryValueExW(hKey, valueName, nullptr, &type,
                       reinterpret_cast<LPBYTE>(buffer), &cb) == ERROR_SUCCESS &&
      (type == REG_SZ || type == REG_EXPAND_SZ)) {
    result.assign(buffer);
  }
  RegCloseKey(hKey);
  return result;
}

std::wstring GetExePath() { return ReadConfigValue(L"ExePath"); }

// Returns the trimmed contents of the pending-left file, or empty if unset.
std::wstring ReadPendingLeft() {
  const std::wstring path = ReadConfigValue(L"PendingLeftPath");
  if (path.empty()) return std::wstring();

  HANDLE hFile = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                             nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                             nullptr);
  if (hFile == INVALID_HANDLE_VALUE) return std::wstring();

  char bytes[4096] = {};
  DWORD read = 0;
  const BOOL ok = ReadFile(hFile, bytes, sizeof(bytes) - 1, &read, nullptr);
  CloseHandle(hFile);
  if (!ok || read == 0) return std::wstring();

  // The file is written as UTF-8 by the Electron side; convert to UTF-16.
  int wlen = MultiByteToWideChar(CP_UTF8, 0, bytes, static_cast<int>(read),
                                 nullptr, 0);
  if (wlen <= 0) return std::wstring();
  std::wstring text(static_cast<size_t>(wlen), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, bytes, static_cast<int>(read), &text[0], wlen);

  // Trim trailing newline / whitespace and take the first line only.
  size_t nl = text.find_first_of(L"\r\n");
  if (nl != std::wstring::npos) text.resize(nl);
  while (!text.empty() && (text.back() == L' ' || text.back() == L'\t')) {
    text.pop_back();
  }
  return text;
}

// Filesystem path of the Nth item in the array, or empty on failure.
std::wstring ItemPath(IShellItemArray* items, DWORD index) {
  std::wstring result;
  if (!items) return result;
  IShellItem* item = nullptr;
  if (SUCCEEDED(items->GetItemAt(index, &item)) && item) {
    PWSTR psz = nullptr;
    if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &psz)) && psz) {
      result.assign(psz);
      CoTaskMemFree(psz);
    }
    item->Release();
  }
  return result;
}

DWORD ItemCount(IShellItemArray* items) {
  DWORD count = 0;
  if (items) items->GetCount(&count);
  return count;
}

// Duplicates a wide string into a CoTaskMem buffer for IExplorerCommand
// out-params (GetTitle / GetIcon / GetToolTip).
HRESULT CloneString(const std::wstring& src, LPWSTR* out) {
  if (!out) return E_POINTER;
  return SHStrDupW(src.c_str(), out);
}

// Wraps a path in double quotes for use on a command line.
std::wstring Quote(const std::wstring& s) {
  std::wstring q;
  q.reserve(s.size() + 2);
  q.push_back(L'"');
  q.append(s);
  q.push_back(L'"');
  return q;
}

// Launches the app exe with the given pre-formatted argument string. Returns
// false (without throwing) if the exe is missing — callers ignore the result
// because Invoke must never propagate a fault back into Explorer.
bool LaunchApp(const std::wstring& args) {
  const std::wstring exe = GetExePath();
  if (exe.empty()) return false;
  if (GetFileAttributesW(exe.c_str()) == INVALID_FILE_ATTRIBUTES) return false;

  std::wstring cmd = Quote(exe);
  cmd.push_back(L' ');
  cmd.append(args);

  // CreateProcessW requires a writable command-line buffer.
  std::wstring mutableCmd = cmd;
  STARTUPINFOW si = {};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi = {};

  const BOOL ok =
      CreateProcessW(exe.c_str(), &mutableCmd[0], nullptr, nullptr, FALSE,
                     CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr, &si, &pi);
  if (!ok) return false;
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return true;
}

// ---------------------------------------------------------------------------
// Verb identities — one row per CLSID. Keeps per-verb behaviour declarative.
// ---------------------------------------------------------------------------

enum class Verb { CompareTwo, SelectLeft, ComparePending };

class CExplorerCommand;

class CEnumExplorerCommand final : public IEnumExplorerCommand {
 public:
  explicit CEnumExplorerCommand(const Verb* verbs, size_t count);

  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override;

  IFACEMETHODIMP_(ULONG) AddRef() override;

  IFACEMETHODIMP_(ULONG) Release() override;

  IFACEMETHODIMP Next(ULONG celt, IExplorerCommand** pUICommand,
                      ULONG* pceltFetched) override;

  IFACEMETHODIMP Skip(ULONG celt) override;

  IFACEMETHODIMP Reset() override;

  IFACEMETHODIMP Clone(IEnumExplorerCommand** ppEnum) override;

 private:
  ~CEnumExplorerCommand();

  const Verb* verbs_;
  size_t count_;
  size_t index_ = 0;
  long cRef_ = 1;
};

// ---------------------------------------------------------------------------
// CExplorerCommand — shared IExplorerCommand implementation for all verbs.
// ---------------------------------------------------------------------------

class CExplorerCommand : public IExplorerCommand {
 public:
  explicit CExplorerCommand(Verb verb) : verb_(verb) { DllAddRef(); }

  // IUnknown -----------------------------------------------------------------
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IExplorerCommand) {
      *ppv = static_cast<IExplorerCommand*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }

  IFACEMETHODIMP_(ULONG) AddRef() override {
    return InterlockedIncrement(&cRef_);
  }

  IFACEMETHODIMP_(ULONG) Release() override {
    const ULONG ref = InterlockedDecrement(&cRef_);
    if (ref == 0) delete this;
    return ref;
  }

  // IExplorerCommand ---------------------------------------------------------
  IFACEMETHODIMP GetTitle(IShellItemArray* items, LPWSTR* ppszName) override {
    if (!ppszName) return E_POINTER;
    *ppszName = nullptr;

    if (verb_ == Verb::ComparePending) {
      const std::wstring left = ReadPendingLeft();
      if (!left.empty()) {
        const wchar_t* base = PathFindFileNameW(left.c_str());
        std::wstring title = L"Compare to ";
        title.append(base && *base ? base : left.c_str());
        return CloneString(title, ppszName);
      }
      // No pending left — fall back to the static label (the verb is hidden
      // by GetState in this case, but be defensive).
      return CloneString(L"Compare to Pending Left", ppszName);
    }

    UNREFERENCED_PARAMETER(items);
    switch (verb_) {
      case Verb::CompareTwo:
        return CloneString(L"Compare with AwapiCompare", ppszName);
      case Verb::SelectLeft:
        return CloneString(L"Select as Left Side", ppszName);
      default:
        return CloneString(L"AwapiCompare", ppszName);
    }
  }

  IFACEMETHODIMP GetIcon(IShellItemArray*, LPWSTR* ppszIcon) override {
    if (!ppszIcon) return E_POINTER;
    *ppszIcon = nullptr;
    const std::wstring exe = GetExePath();
    if (exe.empty()) return S_FALSE;
    std::wstring icon = exe;
    icon.append(L",0");
    return CloneString(icon, ppszIcon);
  }

  IFACEMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* ppszInfotip) override {
    if (ppszInfotip) *ppszInfotip = nullptr;
    return E_NOTIMPL;  // No tooltip.
  }

  IFACEMETHODIMP GetCanonicalName(GUID* pguid) override {
    if (!pguid) return E_POINTER;
    *pguid = CanonicalClsid();
    return S_OK;
  }

  IFACEMETHODIMP GetState(IShellItemArray* items, BOOL /*fOkToBeSlow*/,
                          EXPCMDSTATE* pCmdState) override {
    if (!pCmdState) return E_POINTER;

    // If the app cannot be found, hide the verbs entirely — the static
    // `command` fallback (if any) still applies, and Explorer stays stable.
    if (GetExePath().empty()) {
      *pCmdState = ECS_HIDDEN;
      return S_OK;
    }

    const DWORD count = ItemCount(items);
    switch (verb_) {
      case Verb::CompareTwo:
        // Multi-select: only meaningful for exactly two items.
        *pCmdState = (count == 2) ? ECS_ENABLED : ECS_HIDDEN;
        return S_OK;
      case Verb::SelectLeft:
        *pCmdState = (count == 1) ? ECS_ENABLED : ECS_HIDDEN;
        return S_OK;
      case Verb::ComparePending:
        // Only show "Compare to <left>" for a single item once a left side
        // has actually been picked.
        *pCmdState = (count == 1 && !ReadPendingLeft().empty()) ? ECS_ENABLED
                                                                : ECS_HIDDEN;
        return S_OK;
    }
    *pCmdState = ECS_HIDDEN;
    return S_OK;
  }

  IFACEMETHODIMP Invoke(IShellItemArray* items, IBindCtx*) override {
    switch (verb_) {
      case Verb::CompareTwo: {
        if (ItemCount(items) != 2) return S_OK;
        const std::wstring a = ItemPath(items, 0);
        const std::wstring b = ItemPath(items, 1);
        if (a.empty() || b.empty()) return S_OK;
        std::wstring args = L"--compare-two ";
        args.append(Quote(a)).append(L" ").append(Quote(b));
        LaunchApp(args);
        return S_OK;
      }
      case Verb::SelectLeft: {
        const std::wstring p = ItemPath(items, 0);
        if (p.empty()) return S_OK;
        LaunchApp(L"--set-left " + Quote(p));
        return S_OK;
      }
      case Verb::ComparePending: {
        const std::wstring p = ItemPath(items, 0);
        if (p.empty()) return S_OK;
        LaunchApp(L"--compare-pending " + Quote(p));
        return S_OK;
      }
    }
    return S_OK;
  }

  IFACEMETHODIMP GetFlags(EXPCMDFLAGS* pFlags) override {
    if (!pFlags) return E_POINTER;
    *pFlags = ECF_DEFAULT;
    return S_OK;
  }

  IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** ppEnum) override {
    if (ppEnum) *ppEnum = nullptr;
    return E_NOTIMPL;  // Leaf commands, no sub-menu.
  }

 private:
  GUID CanonicalClsid() const {
    switch (verb_) {
      case Verb::CompareTwo:
        return CLSID_AwapiCompareCompareTwo;
      case Verb::SelectLeft:
        return CLSID_AwapiCompareSelectLeft;
      default:
        return CLSID_AwapiCompareComparePending;
    }
  }

  ~CExplorerCommand() { DllRelease(); }

  Verb verb_;
  long cRef_ = 1;
};

CEnumExplorerCommand::CEnumExplorerCommand(const Verb* verbs, size_t count)
    : verbs_(verbs), count_(count) {
  DllAddRef();
}

IFACEMETHODIMP CEnumExplorerCommand::QueryInterface(REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;
  if (riid == IID_IUnknown || riid == IID_IEnumExplorerCommand) {
    *ppv = static_cast<IEnumExplorerCommand*>(this);
    AddRef();
    return S_OK;
  }
  *ppv = nullptr;
  return E_NOINTERFACE;
}

IFACEMETHODIMP_(ULONG) CEnumExplorerCommand::AddRef() {
  return InterlockedIncrement(&cRef_);
}

IFACEMETHODIMP_(ULONG) CEnumExplorerCommand::Release() {
  const ULONG ref = InterlockedDecrement(&cRef_);
  if (ref == 0) delete this;
  return ref;
}

IFACEMETHODIMP CEnumExplorerCommand::Next(ULONG celt,
                                          IExplorerCommand** pUICommand,
                                          ULONG* pceltFetched) {
  if (!pUICommand) return E_POINTER;
  if (pceltFetched) *pceltFetched = 0;

  ULONG fetched = 0;
  while (fetched < celt && index_ < count_) {
    auto* command = new (std::nothrow) CExplorerCommand(verbs_[index_++]);
    if (!command) {
      while (fetched > 0) {
        pUICommand[--fetched]->Release();
        pUICommand[fetched] = nullptr;
      }
      return E_OUTOFMEMORY;
    }
    pUICommand[fetched++] = command;
  }

  if (pceltFetched) *pceltFetched = fetched;
  return (fetched == celt) ? S_OK : S_FALSE;
}

IFACEMETHODIMP CEnumExplorerCommand::Skip(ULONG celt) {
  index_ = (index_ + celt > count_) ? count_ : index_ + celt;
  return (index_ < count_) ? S_OK : S_FALSE;
}

IFACEMETHODIMP CEnumExplorerCommand::Reset() {
  index_ = 0;
  return S_OK;
}

IFACEMETHODIMP CEnumExplorerCommand::Clone(IEnumExplorerCommand** ppEnum) {
  if (!ppEnum) return E_POINTER;
  *ppEnum = nullptr;
  auto* clone = new (std::nothrow) CEnumExplorerCommand(verbs_, count_);
  if (!clone) return E_OUTOFMEMORY;
  clone->index_ = index_;
  *ppEnum = clone;
  return S_OK;
}

CEnumExplorerCommand::~CEnumExplorerCommand() { DllRelease(); }

class CRootExplorerCommand final : public IExplorerCommand {
 public:
  CRootExplorerCommand() { DllAddRef(); }

  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IExplorerCommand) {
      *ppv = static_cast<IExplorerCommand*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }

  IFACEMETHODIMP_(ULONG) AddRef() override {
    return InterlockedIncrement(&cRef_);
  }

  IFACEMETHODIMP_(ULONG) Release() override {
    const ULONG ref = InterlockedDecrement(&cRef_);
    if (ref == 0) delete this;
    return ref;
  }

  IFACEMETHODIMP GetTitle(IShellItemArray*, LPWSTR* ppszName) override {
    return CloneString(L"AwapiCompare", ppszName);
  }

  IFACEMETHODIMP GetIcon(IShellItemArray*, LPWSTR* ppszIcon) override {
    if (!ppszIcon) return E_POINTER;
    *ppszIcon = nullptr;
    const std::wstring exe = GetExePath();
    if (exe.empty()) return S_FALSE;
    std::wstring icon = exe;
    icon.append(L",0");
    return CloneString(icon, ppszIcon);
  }

  IFACEMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* ppszInfotip) override {
    if (ppszInfotip) *ppszInfotip = nullptr;
    return E_NOTIMPL;
  }

  IFACEMETHODIMP GetCanonicalName(GUID* pguid) override {
    if (!pguid) return E_POINTER;
    *pguid = CLSID_AwapiCompareRoot;
    return S_OK;
  }

  IFACEMETHODIMP GetState(IShellItemArray* items, BOOL,
                          EXPCMDSTATE* pCmdState) override {
    if (!pCmdState) return E_POINTER;
    const std::wstring exe = GetExePath();
    if (exe.empty() || GetFileAttributesW(exe.c_str()) == INVALID_FILE_ATTRIBUTES) {
      *pCmdState = ECS_HIDDEN;
      return S_OK;
    }

    const DWORD count = ItemCount(items);
    if (count == 2) {
      *pCmdState = ECS_ENABLED;
      return S_OK;
    }
    if (count == 1) {
      *pCmdState = ECS_ENABLED;
      return S_OK;
    }

    *pCmdState = ECS_HIDDEN;
    return S_OK;
  }

  IFACEMETHODIMP Invoke(IShellItemArray*, IBindCtx*) override {
    // The root is a container only; clicking it merely expands the submenu.
    return S_OK;
  }

  IFACEMETHODIMP GetFlags(EXPCMDFLAGS* pFlags) override {
    if (!pFlags) return E_POINTER;
    // Tell Explorer this command owns a dynamically-enumerated submenu.
    *pFlags = ECF_HASSUBCOMMANDS;
    return S_OK;
  }

  IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** ppEnum) override {
    if (!ppEnum) return E_POINTER;
    *ppEnum = nullptr;
    // Static lifetime: CEnumExplorerCommand stores the pointer without copying.
    static const Verb kSubVerbs[] = {Verb::SelectLeft, Verb::ComparePending,
                                     Verb::CompareTwo};
    auto* e = new (std::nothrow)
        CEnumExplorerCommand(kSubVerbs, ARRAYSIZE(kSubVerbs));
    if (!e) return E_OUTOFMEMORY;
    *ppEnum = e;
    return S_OK;
  }

 private:
  ~CRootExplorerCommand() { DllRelease(); }

  long cRef_ = 1;
};

// ---------------------------------------------------------------------------
// CClassFactory — produces a CExplorerCommand for the requested verb.
// ---------------------------------------------------------------------------

class CClassFactory : public IClassFactory {
 public:
  explicit CClassFactory(Verb verb) : verb_(verb) { DllAddRef(); }

  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IClassFactory) {
      *ppv = static_cast<IClassFactory*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }

  IFACEMETHODIMP_(ULONG) AddRef() override {
    return InterlockedIncrement(&cRef_);
  }

  IFACEMETHODIMP_(ULONG) Release() override {
    const ULONG ref = InterlockedDecrement(&cRef_);
    if (ref == 0) delete this;
    return ref;
  }

  IFACEMETHODIMP CreateInstance(IUnknown* pUnkOuter, REFIID riid,
                                void** ppv) override {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (pUnkOuter) return CLASS_E_NOAGGREGATION;

    auto* cmd = new (std::nothrow) CExplorerCommand(verb_);
    if (!cmd) return E_OUTOFMEMORY;
    const HRESULT hr = cmd->QueryInterface(riid, ppv);
    cmd->Release();
    return hr;
  }

  IFACEMETHODIMP LockServer(BOOL fLock) override {
    if (fLock) {
      DllAddRef();
    } else {
      DllRelease();
    }
    return S_OK;
  }

 private:
  ~CClassFactory() { DllRelease(); }

  Verb verb_;
  long cRef_ = 1;
};

bool ClsidToVerb(REFCLSID rclsid, Verb* out) {
  if (rclsid == CLSID_AwapiCompareRoot) {
    return false;
  }
  if (rclsid == CLSID_AwapiCompareCompareTwo) {
    *out = Verb::CompareTwo;
    return true;
  }
  if (rclsid == CLSID_AwapiCompareSelectLeft) {
    *out = Verb::SelectLeft;
    return true;
  }
  if (rclsid == CLSID_AwapiCompareComparePending) {
    *out = Verb::ComparePending;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Self-registration (regsvr32 fallback). The Electron installer normally wires
// the registry via PowerShell, but DllRegisterServer keeps the DLL usable
// stand-alone and during native development.
// ---------------------------------------------------------------------------

LONG SetKeyValue(HKEY root, const wchar_t* subkey, const wchar_t* name,
                 const wchar_t* value) {
  HKEY hKey = nullptr;
  LONG rc = RegCreateKeyExW(root, subkey, 0, nullptr, REG_OPTION_NON_VOLATILE,
                            KEY_WRITE, nullptr, &hKey, nullptr);
  if (rc != ERROR_SUCCESS) return rc;
  rc = RegSetValueExW(
      hKey, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(value),
      static_cast<DWORD>((lstrlenW(value) + 1) * sizeof(wchar_t)));
  RegCloseKey(hKey);
  return rc;
}

HRESULT RegisterOneClsid(const wchar_t* clsid, const wchar_t* friendlyName,
                         const wchar_t* modulePath) {
  std::wstring base = L"Software\\Classes\\CLSID\\";
  base.append(clsid);
  if (SetKeyValue(HKEY_CURRENT_USER, base.c_str(), nullptr, friendlyName) !=
      ERROR_SUCCESS) {
    return E_FAIL;
  }
  std::wstring inproc = base + L"\\InprocServer32";
  if (SetKeyValue(HKEY_CURRENT_USER, inproc.c_str(), nullptr, modulePath) !=
      ERROR_SUCCESS) {
    return E_FAIL;
  }
  if (SetKeyValue(HKEY_CURRENT_USER, inproc.c_str(), L"ThreadingModel",
                  L"Apartment") != ERROR_SUCCESS) {
    return E_FAIL;
  }
  return S_OK;
}

void UnregisterOneClsid(const wchar_t* clsid) {
  std::wstring base = L"Software\\Classes\\CLSID\\";
  base.append(clsid);
  RegDeleteTreeW(HKEY_CURRENT_USER, base.c_str());
}

}  // namespace

// ---------------------------------------------------------------------------
// Exported DLL entry points
// ---------------------------------------------------------------------------

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_hModule = hModule;
    DisableThreadLibraryCalls(hModule);
  }
  return TRUE;
}

STDAPI DllCanUnloadNow() { return (g_cDllRef == 0) ? S_OK : S_FALSE; }

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;
  *ppv = nullptr;

  Verb verb;
  if (rclsid == CLSID_AwapiCompareRoot) {
    class CRootFactory final : public IClassFactory {
     public:
      CRootFactory() { DllAddRef(); }
      IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IClassFactory) {
          *ppv = static_cast<IClassFactory*>(this);
          AddRef();
          return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
      }
      IFACEMETHODIMP_(ULONG) AddRef() override {
        return InterlockedIncrement(&cRef_);
      }
      IFACEMETHODIMP_(ULONG) Release() override {
        const ULONG ref = InterlockedDecrement(&cRef_);
        if (ref == 0) delete this;
        return ref;
      }
      IFACEMETHODIMP CreateInstance(IUnknown* pUnkOuter, REFIID riid,
                                    void** ppv) override {
        if (!ppv) return E_POINTER;
        *ppv = nullptr;
        if (pUnkOuter) return CLASS_E_NOAGGREGATION;
        auto* cmd = new (std::nothrow) CRootExplorerCommand();
        if (!cmd) return E_OUTOFMEMORY;
        const HRESULT hr = cmd->QueryInterface(riid, ppv);
        cmd->Release();
        return hr;
      }
      IFACEMETHODIMP LockServer(BOOL fLock) override {
        if (fLock) {
          DllAddRef();
        } else {
          DllRelease();
        }
        return S_OK;
      }

     private:
      ~CRootFactory() { DllRelease(); }
      long cRef_ = 1;
    };

    auto* factory = new (std::nothrow) CRootFactory();
    if (!factory) return E_OUTOFMEMORY;
    const HRESULT hr = factory->QueryInterface(riid, ppv);
    factory->Release();
    return hr;
  }

  if (!ClsidToVerb(rclsid, &verb)) return CLASS_E_CLASSNOTAVAILABLE;

  auto* factory = new (std::nothrow) CClassFactory(verb);
  if (!factory) return E_OUTOFMEMORY;
  const HRESULT hr = factory->QueryInterface(riid, ppv);
  factory->Release();
  return hr;
}

STDAPI DllRegisterServer() {
  wchar_t modulePath[MAX_PATH] = {};
  if (GetModuleFileNameW(g_hModule, modulePath, ARRAYSIZE(modulePath)) == 0) {
    return HRESULT_FROM_WIN32(GetLastError());
  }
  HRESULT hr = RegisterOneClsid(SZ_CLSID_AWAPI_COMPARE_TWO,
                                L"AwapiCompare Compare", modulePath);
  if (SUCCEEDED(hr)) {
    hr = RegisterOneClsid(SZ_CLSID_AWAPI_ROOT, L"AwapiCompare Menu", modulePath);
  }
  if (SUCCEEDED(hr)) {
    hr = RegisterOneClsid(SZ_CLSID_AWAPI_SELECT_LEFT,
                          L"AwapiCompare Select Left", modulePath);
  }
  if (SUCCEEDED(hr)) {
    hr = RegisterOneClsid(SZ_CLSID_AWAPI_COMPARE_PENDING,
                          L"AwapiCompare Compare Pending", modulePath);
  }
  if (SUCCEEDED(hr)) {
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
  }
  return hr;
}

STDAPI DllUnregisterServer() {
  UnregisterOneClsid(SZ_CLSID_AWAPI_ROOT);
  UnregisterOneClsid(SZ_CLSID_AWAPI_COMPARE_TWO);
  UnregisterOneClsid(SZ_CLSID_AWAPI_SELECT_LEFT);
  UnregisterOneClsid(SZ_CLSID_AWAPI_COMPARE_PENDING);
  SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
  return S_OK;
}
