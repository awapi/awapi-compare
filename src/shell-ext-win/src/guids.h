// Stable CLSIDs for the AwapiCompare Explorer command handlers.
//
// These GUIDs are a public contract: they are baked into this DLL *and* into
// the registry wiring written by
// `src/desktop/src/main/services/shellIntegrationService.ts`
// (the `ExplorerCommandHandler` value on each CommandStore verb and the
// `CLSID\{guid}\InprocServer32` server keys). Never change them without
// updating the TypeScript registration and the installer cleanup in lockstep,
// otherwise stale registry entries will point at a handler that no longer
// exists.
//
//   Root submenu    {7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A10}
//   CompareTwo      {7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}
//   SelectLeft      {7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}
//   ComparePending  {7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}

#pragma once

#include <guiddef.h>

// {7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A10}
DEFINE_GUID(CLSID_AwapiCompareRoot, 0x7e2c9a41, 0x3b5d, 0x4c8e, 0x9f, 0x1a,
            0x2d, 0x6b, 0x8c, 0x4e, 0x0a, 0x10);

// {7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}
DEFINE_GUID(CLSID_AwapiCompareCompareTwo, 0x7e2c9a41, 0x3b5d, 0x4c8e, 0x9f, 0x1a,
            0x2d, 0x6b, 0x8c, 0x4e, 0x0a, 0x11);

// {7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}
DEFINE_GUID(CLSID_AwapiCompareSelectLeft, 0x7e2c9a41, 0x3b5d, 0x4c8e, 0x9f, 0x1a,
            0x2d, 0x6b, 0x8c, 0x4e, 0x0a, 0x12);

// {7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}
DEFINE_GUID(CLSID_AwapiCompareComparePending, 0x7e2c9a41, 0x3b5d, 0x4c8e, 0x9f,
            0x1a, 0x2d, 0x6b, 0x8c, 0x4e, 0x0a, 0x13);

// String forms, kept next to the binary forms so the two can never drift.
// Compared (case-insensitively) by the TypeScript registration tests.
#define SZ_CLSID_AWAPI_ROOT L"{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A10}"
#define SZ_CLSID_AWAPI_COMPARE_TWO L"{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A11}"
#define SZ_CLSID_AWAPI_SELECT_LEFT L"{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A12}"
#define SZ_CLSID_AWAPI_COMPARE_PENDING L"{7E2C9A41-3B5D-4C8E-9F1A-2D6B8C4E0A13}"
