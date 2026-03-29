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
        // Older Google Drive sync client
        if let Ok(home) = std::env::var("USERPROFILE") {
            let p = PathBuf::from(&home).join("Google Drive").join("My Drive");
            if p.exists() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
        // Google Drive for Desktop (DriveFS) — scan drive letters for a "My Drive" root
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\My Drive", letter as char);
            if std::path::Path::new(&drive).exists() {
                return Some(drive);
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
            temp::get_temp_dir,
            get_google_drive_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
