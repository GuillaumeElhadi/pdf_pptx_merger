# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

A cross-platform desktop application (primary target: Windows) that merges multiple PDF files with PowerPoint slides interspersed between them into a single PDF output. Built with **Tauri v2** (Rust backend) and **React + TypeScript** (frontend).

## Development Commands

**Install dependencies:**
```bash
npm install
```

**Run in development:**
```bash
npm run tauri dev
```

**Type-check frontend only:**
```bash
npx tsc --noEmit
```

**Check Rust backend only:**
```bash
cd src-tauri && cargo check
```

**Build:**
```bash
npm run tauri build
```

**System requirements:**
- Windows: Microsoft PowerPoint installed (used via COM through PowerShell for PPTX→PDF conversion)
- macOS (dev/testing only): LibreOffice installed — note fidelity differs from PowerPoint output

## Architecture

### Frontend — `src/`

| File | Role |
|---|---|
| `src/store/useMergeStore.ts` | Central Zustand store — all app state and async actions |
| `src/services/bridge.ts` | Thin wrapper over Tauri `invoke` + dialog plugins |
| `src/services/pdfRenderer.ts` | PDF thumbnail rendering via pdf.js |
| `src/hooks/useThumbnail.ts` | React hook for on-demand thumbnail loading |
| `src/types/index.ts` | Shared types: `MergeItem`, `PdfItem`, `SlideGroupItem`, `AppStatus` |
| `src/components/` | UI components (MergeList, SlidePicker, TopBar, StatusBar) |

**State model (in `useMergeStore`):**
- `pptxPath` — path to loaded PPTX
- `slidePdfs` — array of per-slide PDF paths in temp dir (index = 0-based slide number)
- `usedSlideIndices` — Set of slide indices already assigned to a group (prevents reuse)
- `items` — ordered flat list of `MergeItem` (either `PdfItem` or `SlideGroupItem`)

**Data flow:**
1. User loads PPTX → `Bridge.convertPptx()` → `Bridge.splitPdfIntoPages()` → `slidePdfs` populated
2. User adds PDFs → appended to `items` as `PdfItem`
3. User adds a slide group → `SlideGroupItem` appended to `items`, indices added to `usedSlideIndices`
4. User generates → store builds flat list of page paths → `Bridge.mergePdfs()` → output PDF written

### Backend — `src-tauri/src/`

| File | Role |
|---|---|
| `converter.rs` | PPTX→PDF via PowerShell/COM (Windows) or LibreOffice (macOS) |
| `splitter.rs` | PDF split into single-page files using lopdf; also page count query |
| `merger.rs` | Merges an ordered list of PDF paths into one output PDF using lopdf |
| `temp.rs` | Manages the app temp directory (created at startup, cleaned on exit) |
| `lib.rs` | Tauri builder — registers all commands and plugins |

**Tauri commands exposed:**
- `convert_pptx(pptx_path)` → `String` (path to merged PDF)
- `split_pdf_into_pages(pdf_path)` → `Vec<String>` (ordered page paths)
- `get_pdf_page_count(pdf_path)` → `usize`
- `merge_pdfs(page_paths, output_path)` → `()`
- `get_temp_dir()` → `String`

**Key implementation notes:**
- PDF manipulation is done with `lopdf` (pure Rust, no external binaries needed for merge/split)
- `splitter.rs` implements full object-dependency graph traversal (`collect_deps`) to correctly isolate each page including inherited Resources and MediaBox
- `merger.rs` remaps all object IDs when merging to avoid collisions across source documents
- All three heavy commands (`convert_pptx`, `split_pdf_into_pages`, `merge_pdfs`) call blocking I/O inside `async fn` — they should use `tokio::task::spawn_blocking` (known issue)

## Known Issues / Tech Debt

- **Blocking async**: `Command::output()` and synchronous lopdf I/O run directly in `async fn` — can block the Tauri runtime on large files
- **No streaming progress**: long operations report only a binary status string, no N/total progress
- **Slide reuse blocked**: `usedSlideIndices` prevents the same slide from appearing in multiple groups (intentional UX constraint, but limits flexibility)
- **Stale temp files**: reloading a PPTX with fewer slides leaves orphaned `slide_XXXX.pdf` files in temp
- **macOS fidelity**: LibreOffice conversion produces different rendering than PowerPoint (font substitution, layout shifts)
