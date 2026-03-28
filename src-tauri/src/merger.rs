use std::collections::HashMap;

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::splitter::remap_object;

type IdMap = HashMap<ObjectId, ObjectId>;

/// Merges an ordered list of single-page PDFs into one output PDF.
/// The frontend resolves and orders all pages before calling this command.
#[tauri::command]
pub async fn merge_pdfs(page_paths: Vec<String>, output_path: String) -> Result<(), String> {
    if page_paths.is_empty() {
        return Err("No pages to merge".to_string());
    }

    let sources: Vec<Document> = page_paths
        .iter()
        .map(|p| Document::load(p).map_err(|e| format!("Cannot read {p}: {e}")))
        .collect::<Result<_, _>>()?;

    let mut merged = build_merged(&sources).map_err(|e| format!("Merge failed: {e}"))?;
    merged
        .save(&output_path)
        .map_err(|e| format!("Cannot write output PDF: {e}"))?;

    Ok(())
}

fn build_merged(sources: &[Document]) -> Result<Document, lopdf::Error> {
    let mut out = Document::with_version("1.5");
    let pages_id = out.new_object_id();
    let mut all_page_refs: Vec<Object> = Vec::new();

    for src in sources {
        // Allocate new IDs for every object in this source document
        let src_ids: Vec<ObjectId> = src.objects.keys().copied().collect();
        let id_map: IdMap = src_ids
            .iter()
            .map(|&old| (old, out.new_object_id()))
            .collect();

        // Remember which IDs are the page objects before remapping
        let src_page_ids: Vec<ObjectId> = src.page_iter().collect();

        // Copy all objects into the merged doc with remapped references
        for (&old_id, obj) in &src.objects {
            let new_id = id_map[&old_id];
            let remapped = remap_object(obj, &id_map);
            out.objects.insert(new_id, remapped);
        }

        // For each page, update its Parent and collect the new reference
        for old_page_id in src_page_ids {
            let new_page_id = id_map[&old_page_id];
            if let Some(Object::Dictionary(dict)) = out.objects.get_mut(&new_page_id) {
                dict.set("Parent", Object::Reference(pages_id));
            }
            all_page_refs.push(Object::Reference(new_page_id));
        }
    }

    // Build Pages root
    let count = all_page_refs.len() as i64;
    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Kids", Object::Array(all_page_refs));
    pages_dict.set("Count", Object::Integer(count));
    out.objects.insert(pages_id, Object::Dictionary(pages_dict));

    // Build Catalog
    let catalog_id = out.new_object_id();
    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", Object::Reference(pages_id));
    out.objects.insert(catalog_id, Object::Dictionary(catalog));

    out.trailer.set("Root", Object::Reference(catalog_id));
    out.trailer
        .set("Size", Object::Integer((out.max_id + 1) as i64));

    Ok(out)
}
