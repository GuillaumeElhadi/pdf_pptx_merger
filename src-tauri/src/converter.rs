use std::path::Path;
#[cfg(not(target_os = "windows"))]
use std::process::Command;

use crate::temp;

/// Converts a PPTX file to PDF and returns the output PDF path.
/// - Windows: drives PowerPoint via COM using windows-rs (no PowerShell dependency)
/// - macOS/Linux: uses LibreOffice (dev/testing only)
#[tauri::command]
pub async fn convert_pptx(pptx_path: String) -> Result<String, String> {
    let pptx = Path::new(&pptx_path);
    if !pptx.exists() {
        return Err(format!("File not found: {pptx_path}"));
    }

    let out_pdf = temp::get()
        .join("slides_merged.pdf")
        .to_string_lossy()
        .to_string();

    // Spawn a dedicated thread so the COM STA apartment is properly scoped
    // and does not interfere with Tokio's thread pool.
    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
    let pptx_clone = pptx_path.clone();
    let out_pdf_clone = out_pdf.clone();

    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        let result = win_com::convert(&pptx_clone, &out_pdf_clone);

        #[cfg(not(target_os = "windows"))]
        let result = convert_via_libreoffice(&pptx_clone, &out_pdf_clone);

        tx.send(result).ok();
    });

    tokio::task::spawn_blocking(move || {
        rx.recv().unwrap_or_else(|_| Err("Conversion thread panicked".to_string()))
    })
    .await
    .map_err(|e| format!("Thread join error: {e}"))?
    .map(|_| out_pdf)
}

// ── Windows: COM automation via windows-rs ────────────────────────────────────

#[cfg(target_os = "windows")]
mod win_com {
    use std::mem::ManuallyDrop;
    use windows::{
        core::{BSTR, GUID, PCWSTR},
        Win32::System::Com::{
            CLSIDFromProgID, CoCreateInstance, CoInitializeEx, CoUninitialize,
            CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, DISPATCH_FLAGS, DISPATCH_METHOD,
            DISPATCH_PROPERTYGET, DISPPARAMS, IDispatch,
        },
        Win32::System::Ole::{VARIANT, VARIANT_BOOL},
    };

    // Raw VT_ values to avoid VARENUM newtype conversions
    const VT_BSTR: u16 = 8;
    const VT_I4: u16 = 3;
    const VT_BOOL: u16 = 11;
    const VT_DISPATCH: u16 = 9;

    /// Frees resources held by a VARIANT based on its type tag.
    /// Replaces `clear_variant` (whose module path shifted across windows-rs versions).
    unsafe fn clear_variant(v: &mut VARIANT) {
        let vt = v.Anonymous.Anonymous.vt;
        if vt == VT_BSTR {
            ManuallyDrop::drop(&mut v.Anonymous.Anonymous.Anonymous.bstrVal);
            v.Anonymous.Anonymous.vt = 0; // VT_EMPTY
        } else if vt == VT_DISPATCH {
            ManuallyDrop::drop(&mut v.Anonymous.Anonymous.Anonymous.pdispVal);
            v.Anonymous.Anonymous.vt = 0;
        }
    }

    /// Entry point — initialises a COM STA apartment, drives PowerPoint, then
    /// uninitialises. Called from a dedicated std::thread to keep the apartment
    /// separate from Tokio's thread pool.
    pub fn convert(pptx_path: &str, out_pdf: &str) -> Result<(), String> {
        unsafe {
            // CoInitializeEx returns HRESULT directly (S_OK, S_FALSE, or error).
            // 0x80010106 = RPC_E_CHANGED_MODE: thread already initialised with a
            // different apartment model — safe to continue.
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if let Err(e) = hr.ok() {
                if hr.0 as u32 != 0x8001_0106 {
                    return Err(format!("COM init failed: {e}"));
                }
            }
            let result = do_convert(pptx_path, out_pdf);
            CoUninitialize();
            result
        }
    }

    unsafe fn do_convert(pptx_path: &str, out_pdf: &str) -> Result<(), String> {
        // CLSIDFromProgID fails immediately if PowerPoint is not registered —
        // gives a clear error before attempting to launch anything.
        let clsid = CLSIDFromProgID(windows::core::w!("PowerPoint.Application")).map_err(|_| {
            "Microsoft PowerPoint is not installed on this system.\n\
             Please install Microsoft Office with PowerPoint to use this feature."
                .to_string()
        })?;

        let app: IDispatch = CoCreateInstance(&clsid, None, CLSCTX_LOCAL_SERVER)
            .map_err(|e| format!("Failed to start PowerPoint: {e}"))?;

        // app.Presentations
        let presentations = prop_get(&app, "Presentations")?;

        // Presentations.Open(FileName, ReadOnly=True, Untitled=False, WithWindow=False)
        // COM Invoke args are REVERSED: last parameter is at index 0.
        let mut open_args = [
            make_bool(false),      // WithWindow  [param 4 → index 0]
            make_bool(false),      // Untitled    [param 3 → index 1]
            make_bool(true),       // ReadOnly    [param 2 → index 2]
            make_bstr(pptx_path),  // FileName    [param 1 → index 3]
        ];
        let pres = method_to_disp(&presentations, "Open", &mut open_args)?;

        // pres.SaveAs(FileName, FileFormat=32 /* ppSaveAsPDF */)
        let mut save_args = [
            make_i4(32),        // FileFormat  [param 2 → index 0]
            make_bstr(out_pdf), // FileName    [param 1 → index 1]
        ];
        invoke_void(&pres, "SaveAs", &mut save_args)?;

        invoke_void(&pres, "Close", &mut [])?;
        invoke_void(&app, "Quit", &mut [])?;

        // Free the BSTRs we allocated as arguments
        for v in open_args.iter_mut().chain(save_args.iter_mut()) {
            let _ = clear_variant(v);
        }

        Ok(())
    }

    // ── Dispatch helpers ──────────────────────────────────────────────────────

    unsafe fn get_dispid(obj: &IDispatch, name: &str) -> Result<i32, String> {
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let ptr = PCWSTR(wide.as_ptr());
        let mut id = 0i32;
        obj.GetIDsOfNames(&GUID::zeroed(), &ptr, 1, 0x0409, &mut id)
            .map_err(|e| format!("'{name}' not found on COM object: {e}"))?;
        Ok(id)
    }

    unsafe fn invoke_impl(
        obj: &IDispatch,
        name: &str,
        flags: DISPATCH_FLAGS,
        args: &mut [VARIANT],
    ) -> Result<VARIANT, String> {
        let id = get_dispid(obj, name)?;
        let params = DISPPARAMS {
            rgvarg: if args.is_empty() {
                std::ptr::null_mut()
            } else {
                args.as_mut_ptr()
            },
            rgdispidNamedArgs: std::ptr::null_mut(),
            cArgs: args.len() as u32,
            cNamedArgs: 0,
        };
        let mut result = VARIANT::default();
        obj.Invoke(
            id,
            &GUID::zeroed(),
            0x0409,
            flags,
            &params,
            Some(&mut result),
            None,
            None,
        )
        .map_err(|e| format!("Invoke '{name}': {e}"))?;
        Ok(result)
    }

    unsafe fn prop_get(obj: &IDispatch, name: &str) -> Result<IDispatch, String> {
        let mut result = invoke_impl(obj, name, DISPATCH_PROPERTYGET, &mut [])?;
        extract_disp(&mut result, name)
    }

    unsafe fn method_to_disp(
        obj: &IDispatch,
        name: &str,
        args: &mut [VARIANT],
    ) -> Result<IDispatch, String> {
        let mut result = invoke_impl(obj, name, DISPATCH_METHOD, args)?;
        extract_disp(&mut result, name)
    }

    unsafe fn invoke_void(
        obj: &IDispatch,
        name: &str,
        args: &mut [VARIANT],
    ) -> Result<(), String> {
        let mut result = invoke_impl(obj, name, DISPATCH_METHOD, args)?;
        let _ = clear_variant(&mut result);
        Ok(())
    }

    /// Extract an IDispatch from a VARIANT, taking ownership (AddRef via clone,
    /// then clear_variant releases the original reference — net: 0).
    unsafe fn extract_disp(result: &mut VARIANT, ctx: &str) -> Result<IDispatch, String> {
        if result.Anonymous.Anonymous.vt != VT_DISPATCH {
            let _ = clear_variant(result);
            return Err(format!("'{ctx}' did not return a COM dispatch object"));
        }
        let disp = (&*result.Anonymous.Anonymous.Anonymous.pdispVal)
            .as_ref()
            .ok_or_else(|| format!("'{ctx}' returned null"))?
            .clone(); // AddRef
        let _ = clear_variant(result); // Release original reference
        Ok(disp)
    }

    // ── VARIANT constructors ──────────────────────────────────────────────────

    unsafe fn make_bstr(s: &str) -> VARIANT {
        let mut v = VARIANT::default();
        v.Anonymous.Anonymous.vt = VT_BSTR;
        v.Anonymous.Anonymous.Anonymous.bstrVal = ManuallyDrop::new(BSTR::from(s));
        v
    }

    unsafe fn make_i4(n: i32) -> VARIANT {
        let mut v = VARIANT::default();
        v.Anonymous.Anonymous.vt = VT_I4;
        v.Anonymous.Anonymous.Anonymous.lVal = n;
        v
    }

    unsafe fn make_bool(b: bool) -> VARIANT {
        let mut v = VARIANT::default();
        v.Anonymous.Anonymous.vt = VT_BOOL;
        v.Anonymous.Anonymous.Anonymous.boolVal = VARIANT_BOOL(if b { -1 } else { 0 });
        v
    }
}

// ── macOS / Linux: LibreOffice (dev only) ─────────────────────────────────────

#[cfg(not(target_os = "windows"))]
fn convert_via_libreoffice(pptx_path: &str, out_pdf: &str) -> Result<(), String> {
    let out_dir = temp::get().to_string_lossy().to_string();

    let soffice = ["libreoffice", "soffice"]
        .iter()
        .find_map(|cmd| which_cmd(cmd))
        .or_else(|| {
            let bundled = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
            std::path::Path::new(bundled).exists().then(|| bundled.to_string())
        })
        .ok_or_else(|| {
            "LibreOffice not found. Install it with: brew install --cask libreoffice".to_string()
        })?;

    let output = Command::new(&soffice)
        .args([
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            &out_dir,
            pptx_path,
        ])
        .output()
        .map_err(|e| format!("Failed to launch LibreOffice ({soffice}): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("LibreOffice conversion failed: {stderr}"));
    }

    let stem = std::path::Path::new(pptx_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let produced = std::path::Path::new(&out_dir).join(format!("{stem}.pdf"));
    std::fs::rename(&produced, out_pdf)
        .map_err(|e| format!("Could not move converted PDF: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn which_cmd(cmd: &str) -> Option<String> {
    Command::new("which")
        .arg(cmd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}
