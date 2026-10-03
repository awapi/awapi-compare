//! Helpers shared by the classic `IContextMenu` handler and the Windows 11
//! `IExplorerCommand` handler: path classification, EXE discovery, pending
//! left-side lookup, and process launch.

use windows::core::{w, Error, Result, PCWSTR};
use windows::Win32::Foundation::E_FAIL;
use windows::Win32::Storage::FileSystem::{
    GetFileAttributesW, FILE_ATTRIBUTE_DIRECTORY, INVALID_FILE_ATTRIBUTES,
};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// Registry key (under HKCU) where the installer writes the EXE path.
const REGKEY_AWAPI: PCWSTR = w!("Software\\AwapiCompare");
const REGVAL_EXE_PATH: PCWSTR = w!("ExePath");

/// Returns `true` if `path` is a directory (or a directory reparse point).
pub(crate) fn is_directory(path: &str) -> bool {
    let wide: Vec<u16> = path.encode_utf16().chain(core::iter::once(0)).collect();
    let attrs = unsafe { GetFileAttributesW(PCWSTR(wide.as_ptr())) };
    if attrs == INVALID_FILE_ATTRIBUTES {
        return false;
    }
    attrs & FILE_ATTRIBUTE_DIRECTORY.0 != 0
}

/// Reads `HKCU\Software\AwapiCompare\ExePath` to find the main executable.
///
/// Written by the registration PowerShell script so the DLL does not need
/// to hard-code or probe for the EXE location.
pub(crate) fn get_exe_path() -> Option<String> {
    let mut buf = vec![0u16; 1024];
    let mut size = (buf.len() * 2) as u32;

    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            REGKEY_AWAPI,
            REGVAL_EXE_PATH,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };

    if !result.is_ok() {
        return None;
    }

    // `size` is in bytes including the NUL terminator.
    let wchar_count = (size / 2) as usize;
    let trimmed = wchar_count.saturating_sub(1); // drop NUL
    Some(String::from_utf16_lossy(&buf[..trimmed]))
}

/// Spawns `AwapiCompare.exe <params>` via `ShellExecuteW`.
///
/// Windows paths cannot legally contain double-quote characters, so callers
/// may embed paths inside `"..."` without additional escaping.
pub(crate) fn launch_awapi(exe: &str, params: &str) -> Result<()> {
    let exe_wide: Vec<u16> = exe.encode_utf16().chain(core::iter::once(0)).collect();
    let params_wide: Vec<u16> = params.encode_utf16().chain(core::iter::once(0)).collect();

    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(exe_wide.as_ptr()),
            PCWSTR(params_wide.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW returns a pseudo-HINSTANCE; values > 32 indicate success.
    if result.0 as usize > 32 {
        Ok(())
    } else {
        Err(Error::from(E_FAIL))
    }
}

/// Returns the path stored by `AwapiCompare.exe --set-left <path>`, if any.
///
/// The desktop app persists the pick as JSON at
/// `%APPDATA%\AwapiCompare\shell-pick.json` (Electron's `userData` dir):
///
/// ```json
/// {"path":"C:\\some\\folder","ts":1730000000000}
/// ```
///
/// We only need the `path` member, so a minimal JSON string extraction is
/// used instead of a full parser dependency.
pub(crate) fn pending_left_path() -> Option<String> {
    let appdata = std::env::var_os("APPDATA")?;
    let file = std::path::Path::new(&appdata)
        .join("AwapiCompare")
        .join("shell-pick.json");
    let raw = std::fs::read_to_string(file).ok()?;
    let path = extract_json_string(&raw, "path")?;
    if path.is_empty() { None } else { Some(path) }
}

/// Extracts the string value of `key` from a flat JSON object, handling the
/// escape sequences `JSON.stringify` can produce for Windows paths
/// (`\\`, `\"`, `\/`, `\uXXXX`, and the control-character escapes).
fn extract_json_string(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let after_key = &json[json.find(&needle)? + needle.len()..];
    let after_colon = after_key.trim_start().strip_prefix(':')?;
    let body = after_colon.trim_start().strip_prefix('"')?;

    let mut out = String::new();
    let mut chars = body.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some(out),
            '\\' => match chars.next()? {
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                '/' => out.push('/'),
                'b' => out.push('\u{0008}'),
                'f' => out.push('\u{000C}'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                'u' => {
                    let hex: String = chars.by_ref().take(4).collect();
                    let cp = u32::from_str_radix(&hex, 16).ok()?;
                    if (0xD800..0xDC00).contains(&cp) {
                        // High surrogate — must be followed by \uDCxx.
                        if chars.next()? != '\\' || chars.next()? != 'u' {
                            return None;
                        }
                        let hex2: String = chars.by_ref().take(4).collect();
                        let lo = u32::from_str_radix(&hex2, 16).ok()?;
                        let combined = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        out.push(char::from_u32(combined)?);
                    } else {
                        out.push(char::from_u32(cp)?);
                    }
                }
                _ => return None,
            },
            _ => out.push(c),
        }
    }
    None // unterminated string
}

/// Returns the final path component (file or folder name) of a Windows path.
pub(crate) fn base_name(path: &str) -> &str {
    path.trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::{base_name, extract_json_string};

    #[test]
    fn extracts_plain_path() {
        let json = r#"{"path":"C:\\Users\\omer\\left","ts":123}"#;
        assert_eq!(
            extract_json_string(json, "path").as_deref(),
            Some("C:\\Users\\omer\\left")
        );
    }

    #[test]
    fn extracts_with_spaces_after_colon() {
        let json = r#"{ "path" : "D:\\a b\\c" }"#;
        assert_eq!(extract_json_string(json, "path").as_deref(), Some("D:\\a b\\c"));
    }

    #[test]
    fn extracts_unicode_escape() {
        let json = r#"{"path":"C:\\caf\u00e9"}"#;
        assert_eq!(extract_json_string(json, "path").as_deref(), Some("C:\\café"));
    }

    #[test]
    fn missing_key_returns_none() {
        assert_eq!(extract_json_string(r#"{"other":"x"}"#, "path"), None);
    }

    #[test]
    fn base_name_handles_trailing_separator() {
        assert_eq!(base_name("C:\\a\\b\\"), "b");
        assert_eq!(base_name("C:\\a\\b.txt"), "b.txt");
    }
}
