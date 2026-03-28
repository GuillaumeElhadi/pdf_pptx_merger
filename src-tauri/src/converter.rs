use std::path::Path;
use std::process::Command;

use crate::temp;

/// Converts a PPTX file to PDF and returns the output PDF path.
/// - Windows: uses PowerShell to drive PowerPoint via COM
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

    #[cfg(target_os = "windows")]
    convert_via_powershell(&pptx_path, &out_pdf)?;

    #[cfg(not(target_os = "windows"))]
    convert_via_libreoffice(&pptx_path, &out_pdf)?;

    Ok(out_pdf)
}

#[cfg(target_os = "windows")]
fn convert_via_powershell(pptx_path: &str, out_pdf: &str) -> Result<(), String> {
    // Normalise paths to backslashes for PowerShell
    let pptx_abs = std::path::Path::new(pptx_path)
        .canonicalize()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    let pdf_abs = std::path::Path::new(out_pdf)
        .parent()
        .ok_or("invalid output path")?
        .join(std::path::Path::new(out_pdf).file_name().unwrap())
        .to_string_lossy()
        .to_string();

    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = [Microsoft.Office.Core.MsoTriState]::msoFalse
try {{
    $pres = $ppt.Presentations.Open('{pptx}', $true, $false, $false)
    $pres.SaveAs('{pdf}', 32)
    $pres.Close()
}} finally {{
    $ppt.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
}}
"#,
        pptx = pptx_abs.replace('\'', "''"),
        pdf = pdf_abs.replace('\'', "''"),
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("Failed to launch PowerShell: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "PowerPoint conversion failed.\n\
             Make sure Microsoft PowerPoint is installed.\n\
             Details: {stderr}"
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn convert_via_libreoffice(pptx_path: &str, out_pdf: &str) -> Result<(), String> {
    let out_dir = temp::get().to_string_lossy().to_string();

    // Locate the soffice binary: check PATH first, then the standard macOS app bundle.
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
        .map_err(|e| format!("Failed to launch LibreOffice ({soffice}): {e}"))? ;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("LibreOffice conversion failed: {stderr}"));
    }

    // LibreOffice writes <stem>.pdf in the outdir — rename it to our expected path
    let stem = std::path::Path::new(pptx_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let produced = std::path::Path::new(&out_dir).join(format!("{stem}.pdf"));
    std::fs::rename(&produced, out_pdf)
        .map_err(|e| format!("Could not move converted PDF: {e}"))?;

    Ok(())
}

/// Returns the full path of `cmd` if it is findable on PATH, otherwise None.
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
