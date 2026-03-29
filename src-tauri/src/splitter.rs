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

/// Extracts a single page from a PDF into a temp file and returns its path.
/// The output file is named `preview_page_<index>.pdf` in the app temp dir.
#[tauri::command]
pub async fn extract_pdf_page(pdf_path: String, page_index: usize) -> Result<String, String> {
    use crate::temp;

    tokio::task::spawn_blocking(move || {
        let mut doc = Document::load(&pdf_path).map_err(|e| format!("Cannot read PDF: {e}"))?;

        let pages: Vec<_> = doc.page_iter().collect();
        if page_index >= pages.len() {
            return Err(format!(
                "Page index {page_index} out of range (document has {} pages)",
                pages.len()
            ));
        }

        // Keep only the target page, delete all others
        let total = pages.len();
        let pages_to_delete: Vec<u32> = (0..total)
            .filter(|&i| i != page_index)
            .map(|i| (i + 1) as u32)
            .collect();
        doc.delete_pages(&pages_to_delete);
        doc.compress();

        let out_path = temp::get()
            .join(format!("preview_page_{page_index}.pdf"))
            .to_string_lossy()
            .to_string();

        doc.save(&out_path)
            .map_err(|e| format!("Cannot write page PDF: {e}"))?;

        Ok(out_path)
    })
    .await
    .map_err(|e| format!("Thread join error: {e}"))?
}
