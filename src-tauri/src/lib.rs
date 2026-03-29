mod converter;
mod splitter;
mod temp;

/// Detects the Google Drive for Desktop "My Drive" folder.
/// Returns the path as a String, or None if not found.
#[tauri::command]
fn get_google_drive_path() -> Option<String> {
    use std::path::PathBuf;

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let drive_folder_names = ["My Drive", "Mon Drive", "Mi unidad", "Mein Ablageplatz", "Il mio Drive"];

        // Google Drive for Desktop (DriveFS) — read mount point from registry (most reliable)
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(prefs) = hkcu.open_subkey("Software\\Google\\DriveFS\\PerAccountPreferences") {
            for account in prefs.enum_keys().flatten() {
                if let Ok(account_key) = prefs.open_subkey(&account) {
                    if let Ok(mount_point) = account_key.get_value::<String, _>("mount_point_path") {
                        let base = PathBuf::from(&mount_point);
                        for name in &drive_folder_names {
                            let p = base.join(name);
                            if p.exists() {
                                return Some(p.to_string_lossy().into_owned());
                            }
                        }
                    }
                }
            }
        }

        // Older Google Drive for Desktop / Backup & Sync — check USERPROFILE
        if let Ok(home) = std::env::var("USERPROFILE") {
            let base = PathBuf::from(&home).join("Google Drive");
            // New-style: subfolder "My Drive" (or locale variant)
            for name in &drive_folder_names {
                let p = base.join(name);
                if p.exists() {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
            // Old Backup & Sync: files directly in "Google Drive" (no subfolder)
            if base.exists() {
                return Some(base.to_string_lossy().into_owned());
            }
        }

        // Last resort: scan all drive letters for a DriveFS virtual drive
        for letter in b'A'..=b'Z' {
            let base = PathBuf::from(format!("{}:\\", letter as char));
            for name in &drive_folder_names {
                let p = base.join(name);
                if p.exists() {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // "My Drive" folder name varies by locale (e.g. "Mon Drive" in French)
        let drive_folder_names = ["My Drive", "Mon Drive", "Mi unidad", "Mein Ablageplatz"];

        if let Ok(home) = std::env::var("HOME") {
            // Newer: ~/Library/CloudStorage/GoogleDrive-<email>/<locale name>
            let cloud = PathBuf::from(&home).join("Library").join("CloudStorage");
            if let Ok(entries) = std::fs::read_dir(&cloud) {
                for entry in entries.flatten() {
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("GoogleDrive-")
                    {
                        for name in &drive_folder_names {
                            let p = entry.path().join(name);
                            if p.exists() {
                                return Some(p.to_string_lossy().into_owned());
                            }
                        }
                    }
                }
            }
            // Older sync client
            for name in &drive_folder_names {
                let p = PathBuf::from(&home).join("Google Drive").join(name);
                if p.exists() {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
        }
    }

    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|_app| {
            temp::init()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            converter::convert_pptx,
            splitter::get_pdf_page_count,
            splitter::extract_pdf_page,
            temp::get_temp_dir,
            get_google_drive_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
