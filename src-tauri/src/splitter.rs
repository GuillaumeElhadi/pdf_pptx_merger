use std::collections::{HashMap, HashSet};
use std::fs;

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::temp;

type IdMap = HashMap<ObjectId, ObjectId>;

/// Splits a PDF into individual single-page files in the temp directory.
/// Returns an ordered list of output file paths.
#[tauri::command]
pub async fn split_pdf_into_pages(pdf_path: String) -> Result<Vec<String>, String> {
    let src = Document::load(&pdf_path).map_err(|e| format!("Cannot read PDF: {e}"))?;
    let pages_dir = temp::get().join("slides");
    fs::create_dir_all(&pages_dir).map_err(|e| e.to_string())?;

    let page_ids: Vec<ObjectId> = src.page_iter().collect();
    let mut out_paths = Vec::with_capacity(page_ids.len());

    for (i, &page_id) in page_ids.iter().enumerate() {
        let out = pages_dir.join(format!("slide_{i:04}.pdf"));
        extract_single_page(&src, page_id, &out.to_string_lossy())
            .map_err(|e| format!("Cannot extract slide {i}: {e}"))?;
        out_paths.push(out.to_string_lossy().to_string());
    }

    Ok(out_paths)
}

/// Returns the number of pages in a PDF (without splitting).
#[tauri::command]
pub async fn get_pdf_page_count(pdf_path: String) -> Result<usize, String> {
    let doc = Document::load(&pdf_path).map_err(|e| format!("Cannot read PDF: {e}"))?;
    Ok(doc.page_iter().count())
}

// ── Internal helpers ─────────────────────────────────────────────────────────

fn extract_single_page(src: &Document, page_id: ObjectId, output: &str) -> Result<(), lopdf::Error> {
    let mut out = Document::with_version("1.5");
    let pages_id = out.new_object_id();

    // Collect only the objects that this page transitively depends on
    let mut deps: HashSet<ObjectId> = HashSet::new();
    collect_deps(src, &Object::Reference(page_id), &mut deps);

    // Build ID map: old ID → new ID in output doc
    let id_map: IdMap = deps.iter()
        .map(|&old| (old, out.new_object_id()))
        .collect();

    // Copy the dependent objects with remapped references
    for (&old_id, obj) in &src.objects {
        if let Some(&new_id) = id_map.get(&old_id) {
            let remapped = remap_object(obj, &id_map);
            out.objects.insert(new_id, remapped);
        }
    }

    // Fix the page's Parent to point at our new Pages root
    let new_page_id = id_map[&page_id];
    if let Some(Object::Dictionary(dict)) = out.objects.get_mut(&new_page_id) {
        dict.set("Parent", Object::Reference(pages_id));
        // Inject inherited MediaBox if missing
        if !dict.has(b"MediaBox") {
            if let Some(media_box) = get_inherited(src, page_id, b"MediaBox") {
                dict.set("MediaBox", remap_object(&media_box, &id_map));
            }
        }
        // Inject inherited Resources if missing
        if !dict.has(b"Resources") {
            if let Some(resources) = get_inherited(src, page_id, b"Resources") {
                dict.set("Resources", remap_object(&resources, &id_map));
            }
        }
    }

    // Build Pages node
    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Kids", Object::Array(vec![Object::Reference(new_page_id)]));
    pages_dict.set("Count", Object::Integer(1));
    out.objects.insert(pages_id, Object::Dictionary(pages_dict));

    // Build Catalog
    let catalog_id = out.new_object_id();
    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", Object::Reference(pages_id));
    out.objects.insert(catalog_id, Object::Dictionary(catalog));

    out.trailer.set("Root", Object::Reference(catalog_id));
    out.trailer.set("Size", Object::Integer((out.max_id + 1) as i64));
    out.save(output)?;
    Ok(())
}

/// Recursively collect all ObjectIds that `obj` transitively references.
fn collect_deps(src: &Document, obj: &Object, seen: &mut HashSet<ObjectId>) {
    match obj {
        Object::Reference(id) => {
            if seen.insert(*id) {
                if let Ok(referenced) = src.get_object(*id) {
                    collect_deps(src, referenced, seen);
                }
            }
        }
        Object::Array(arr) => arr.iter().for_each(|o| collect_deps(src, o, seen)),
        Object::Dictionary(d) => d.iter().for_each(|(_, v)| collect_deps(src, v, seen)),
        Object::Stream(s) => s.dict.iter().for_each(|(_, v)| collect_deps(src, v, seen)),
        _ => {}
    }
}

/// Walk up the page tree to find an inherited attribute.
fn get_inherited(src: &Document, node_id: ObjectId, key: &[u8]) -> Option<Object> {
    let obj = src.get_object(node_id).ok()?;
    if let Object::Dictionary(dict) = obj {
        if dict.has(key) {
            return dict.get(key).ok().cloned();
        }
        if let Ok(Object::Reference(parent_id)) = dict.get(b"Parent") {
            return get_inherited(src, *parent_id, key);
        }
    }
    None
}

// ── Object remapping ──────────────────────────────────────────────────────────

pub(crate) fn remap_object(obj: &Object, map: &IdMap) -> Object {
    match obj {
        Object::Reference(id) => Object::Reference(map.get(id).copied().unwrap_or(*id)),
        Object::Array(arr) => Object::Array(arr.iter().map(|o| remap_object(o, map)).collect()),
        Object::Dictionary(dict) => Object::Dictionary(remap_dict(dict, map)),
        Object::Stream(stream) => {
            let mut s = stream.clone();
            s.dict = remap_dict(&stream.dict, map);
            Object::Stream(s)
        }
        other => other.clone(),
    }
}

pub(crate) fn remap_dict(dict: &Dictionary, map: &IdMap) -> Dictionary {
    let mut new_dict = Dictionary::new();
    for (k, v) in dict.iter() {
        new_dict.set(k.clone(), remap_object(v, map));
    }
    new_dict
}
