# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

A Windows desktop application that merges multiple PDF files with PowerPoint slides interspersed between them into a single PDF output. Built with Tkinter for GUI, requires Microsoft PowerPoint (via COM) and Poppler to be installed on the system.

## Development Commands

**Setup:**
```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

**Run in development:**
```bash
.venv\Scripts\activate
python app.py
```

**Build standalone EXE:**
```bash
.venv\Scripts\activate
pyinstaller pdf_pptx_merger.spec
# Output: dist\PDFPPTXMerger.exe
```

**System requirements (Windows only):**
- Microsoft PowerPoint installed (used via COM for PPTX→PDF conversion)
- Poppler for Windows extracted to `C:\poppler\`, with `C:\poppler\Library\bin` in PATH

## Architecture

All application logic lives in a single file: `app.py` (~628 lines).

**Core functions:**
- `convert_pptx_to_pdf(pptx_path, output_pdf_path)` — uses `pywin32`/`comtypes` to invoke `PowerPoint.Application` via COM
- `split_pdf_into_pages(pdf_path, output_dir)` — splits a PDF into one file per page using `pypdf`
- `render_pdf_page_as_image(pdf_path, page_index, size)` — renders a PDF page as a Tkinter image using `pdf2image` + Poppler

**UI classes:**
- `ThumbnailButton` — clickable thumbnail widget with selection highlight
- `PDFSlot` — represents one PDF in the merge list with move/remove controls
- `SlidePickerDialog` — modal dialog to pick which slide to insert between two PDFs
- `App` — main window; holds all application state

**Application state (on `App`):**
- `pptx_path` — path to loaded PPTX file
- `slide_pdfs` — list of per-slide PDF paths (one per PPTX slide, stored in temp dir)
- `pdf_slots` — ordered list of user-loaded PDF paths
- `intercalaires` — parallel list to `pdf_slots`; each entry is either a slide index or `None` (slide to insert *after* that PDF)

**Data flow:**
1. User loads PPTX → async thread converts via COM → splits into per-slide PDFs → thumbnails rendered on demand
2. User adds PDFs → appended to `pdf_slots`, `None` appended to `intercalaires`
3. User clicks intercalaire button → `SlidePickerDialog` opens → stores chosen slide index
4. User generates → async thread iterates `pdf_slots`, interleaves selected slides, writes merged PDF via `pypdf.PdfWriter`

**Threading:** Long operations (PPTX conversion, PDF generation) run in `threading.Thread` to keep the UI responsive. UI updates from threads go through `self.after()`.

**Temp directory:** Created at startup via `tempfile.mkdtemp()`, cleaned up in `_on_close()`.

## Build System

`pdf_pptx_merger.spec` is the PyInstaller spec file. It:
- Bundles Poppler DLLs/EXEs as `binaries`
- Uses a runtime hook (`hooks/hook-poppler.py`) to set `POPPLER_PATH` at runtime
- Sets `console=False` (no terminal window)
- Declares hidden imports for `comtypes` and `win32com`

The CI workflow (`.github/workflows/build.yml`) patches the spec file with the correct Poppler path before building, then uploads the EXE to GitHub Releases on release events.
