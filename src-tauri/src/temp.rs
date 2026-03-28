use std::path::PathBuf;
use std::sync::OnceLock;

use tempfile::TempDir;

/// The temp directory is held in a static so it is never dropped during the app's lifetime
/// (the OS cleans it up on process exit). The path is exposed for Tauri commands.
static TEMP_DIR: OnceLock<TempDir> = OnceLock::new();

pub fn init() -> Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::Builder::new()
        .prefix("pdf_merger_")
        .tempdir()?;
    TEMP_DIR.set(dir).map_err(|_| "temp dir already initialised")?;
    Ok(())
}

pub fn get() -> &'static PathBuf {
    // Safety: init() is called from setup() before any commands run.
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        TEMP_DIR
            .get()
            .expect("temp dir not initialised — call temp::init() in setup()")
            .path()
            .to_path_buf()
    })
}

#[tauri::command]
pub fn get_temp_dir() -> String {
    get().to_string_lossy().to_string()
}
