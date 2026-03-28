mod converter;
mod merger;
mod splitter;
mod temp;

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
            splitter::split_pdf_into_pages,
            splitter::get_pdf_page_count,
            merger::merge_pdfs,
            temp::get_temp_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
