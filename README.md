# PDF + PPTX Merger

Fusionne plusieurs PDFs en intercalant des slides PowerPoint entre eux,
et génère un PDF final unique.

---

## Prérequis système

- Windows 10 ou 11
- Microsoft PowerPoint installé (nécessaire pour la conversion PPTX → PDF)
- Python 3.11+ (seulement pour le build — pas nécessaire sur les machines cibles)
- [Poppler pour Windows](https://github.com/oschwartz10612/poppler-windows/releases)
  — requis par `pdf2image` pour les miniatures

---

## Installation (environnement de développement)

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install pyinstaller
```

### Installer Poppler

1. Télécharger la dernière release depuis https://github.com/oschwartz10612/poppler-windows/releases
2. Extraire dans `C:\poppler\`
3. Ajouter `C:\poppler\Library\bin` au PATH système

---

## Lancer en développement

```bat
.venv\Scripts\activate
python app.py
```

---

## Générer le .exe autonome

```bat
.venv\Scripts\activate
pyinstaller pdf_pptx_merger.spec
```

Le fichier `dist\PDFPPTXMerger.exe` est autonome.

**Attention :** l'exe a besoin que les DLLs de Poppler soient accessibles.
Deux options :
- Les inclure dans le même dossier que l'exe (copier `C:\poppler\Library\bin\*.dll`)
- Ou les ajouter dans le `datas` du fichier `.spec`

PowerPoint doit être installé sur la machine qui fait tourner l'exe.

---

## Utilisation

1. **Charger le PPTX** — PowerPoint est lancé en arrière-plan pour convertir les slides.
2. **Ajouter des PDFs** — Autant que nécessaire, réordonnables.
3. **Choisir les slides intercalaires** — Cliquer sur « Choisir une slide… » entre chaque paire de PDFs.
4. **Générer le PDF** — Choisir l'emplacement de sauvegarde.

---

## Architecture

```
app.py
├── convert_pptx_to_pdf()     — COM PowerPoint → PDF
├── split_pdf_into_pages()    — pypdf : 1 fichier par slide
├── render_pdf_page_as_image()— pdf2image : miniatures UI
├── SlidePickerDialog         — Fenêtre modale de sélection de slide
├── App (tk.Tk)               — Application principale
│   ├── _load_pptx()          — Chargement + conversion asynchrone
│   ├── _add_pdfs()           — Ajout de PDFs
│   ├── _pick_slide()         — Ouvre SlidePickerDialog
│   └── _generate()           — Fusion finale via pypdf
```

---

## Dépendances

| Lib | Usage |
|-----|-------|
| `pypdf` | Lecture et fusion des PDFs |
| `Pillow` | Manipulation d'images pour les miniatures |
| `pdf2image` | Rendu des pages PDF en images (via Poppler) |
| `pywin32` + `comtypes` | Pilotage de PowerPoint via COM |
| `tkinter` | Interface graphique (stdlib Python) |
