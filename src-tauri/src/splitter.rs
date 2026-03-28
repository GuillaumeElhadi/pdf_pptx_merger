use lopdf::Document;

/// Returns the number of pages in a PDF (without splitting).
#[tauri::command]
pub async fn get_pdf_page_count(pdf_path: String) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        let doc = Document::load(&pdf_path).map_err(|e| format!("Cannot read PDF: {e}"))?;
        Ok(doc.page_iter().count())
    })
    .await
    .map_err(|e| format!("Thread join error: {e}"))?
}
