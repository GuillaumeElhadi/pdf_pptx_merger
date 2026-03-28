"""
PDF + PPTX Merger
Intercale des slides PowerPoint entre des PDFs et génère un PDF fusionné.
Dépendances : pypdf, Pillow, pywin32
"""

import os
import sys
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
import tempfile
import shutil
from pathlib import Path
from PIL import Image, ImageTk
from pypdf import PdfWriter, PdfReader


# ─────────────────────────────────────────────
# Conversion PPTX → PDF via COM PowerPoint
# ─────────────────────────────────────────────

def convert_pptx_to_pdf(pptx_path: str, output_pdf_path: str) -> None:
    """Utilise PowerPoint via COM pour exporter le PPTX en PDF."""
    import comtypes.client
    powerpoint = None
    presentation = None
    try:
        powerpoint = comtypes.client.CreateObject("Powerpoint.Application")
        powerpoint.Visible = 1
        abs_pptx = str(Path(pptx_path).resolve())
        abs_pdf = str(Path(output_pdf_path).resolve())
        presentation = powerpoint.Presentations.Open(abs_pptx, ReadOnly=True, Untitled=False, WithWindow=False)
        # 32 = ppSaveAsPDF
        presentation.SaveAs(abs_pdf, 32)
    finally:
        if presentation:
            presentation.Close()
        if powerpoint:
            powerpoint.Quit()


def split_pdf_into_pages(pdf_path: str, output_dir: str) -> list[str]:
    """Découpe un PDF en pages individuelles, retourne la liste des chemins."""
    reader = PdfReader(pdf_path)
    page_paths = []
    for i, page in enumerate(reader.pages):
        writer = PdfWriter()
        writer.add_page(page)
        out_path = os.path.join(output_dir, f"page_{i:04d}.pdf")
        with open(out_path, "wb") as f:
            writer.write(f)
        page_paths.append(out_path)
    return page_paths


def render_pdf_page_as_image(pdf_path: str, page_index: int = 0, size: tuple = (160, 120)) -> ImageTk.PhotoImage:
    """Rend une page PDF en miniature PIL pour l'UI."""
    try:
        from pdf2image import convert_from_path
        poppler_path = os.environ.get("POPPLER_PATH") or None
        images = convert_from_path(
            pdf_path,
            first_page=page_index + 1,
            last_page=page_index + 1,
            dpi=72,
            poppler_path=poppler_path,
        )
        if images:
            img = images[0]
            img.thumbnail(size, Image.LANCZOS)
            # Centre sur fond blanc
            canvas_img = Image.new("RGB", size, (240, 240, 240))
            offset = ((size[0] - img.width) // 2, (size[1] - img.height) // 2)
            canvas_img.paste(img, offset)
            return ImageTk.PhotoImage(canvas_img)
    except Exception:
        pass
    # Fallback : image grise avec numéro
    img = Image.new("RGB", size, (200, 200, 210))
    return ImageTk.PhotoImage(img)


# ─────────────────────────────────────────────
# Widgets personnalisés
# ─────────────────────────────────────────────

class ThumbnailButton(tk.Frame):
    """Bouton affichant une miniature de slide, sélectionnable."""

    def __init__(self, parent, slide_index: int, image: ImageTk.PhotoImage,
                 on_select, **kwargs):
        super().__init__(parent, **kwargs)
        self.slide_index = slide_index
        self.on_select = on_select
        self._selected = False

        self.configure(bg="#2b2b2b", relief="flat", bd=2)

        self.img_label = tk.Label(self, image=image, bg="#2b2b2b", cursor="hand2")
        self.img_label.image = image  # keep ref
        self.img_label.pack(padx=4, pady=4)

        self.num_label = tk.Label(self, text=f"Slide {slide_index + 1}",
                                  bg="#2b2b2b", fg="#aaaaaa", font=("Segoe UI", 8))
        self.num_label.pack(pady=(0, 4))

        self.img_label.bind("<Button-1>", self._click)
        self.num_label.bind("<Button-1>", self._click)

    def _click(self, _event=None):
        self.on_select(self.slide_index)

    def set_selected(self, selected: bool):
        self._selected = selected
        color = "#4a9eff" if selected else "#2b2b2b"
        border = "#4a9eff" if selected else "#3c3c3c"
        self.configure(bg=color, highlightbackground=border,
                        highlightthickness=2 if selected else 0)
        self.img_label.configure(bg=color)
        self.num_label.configure(bg=color, fg="white" if selected else "#aaaaaa")


class PDFSlot(tk.Frame):
    """Représente un PDF dans la liste, avec son slide intercalé en dessous."""

    def __init__(self, parent, index: int, pdf_path: str,
                 on_remove, on_move_up, on_move_down, **kwargs):
        super().__init__(parent, bg="#1e1e1e", **kwargs)
        self.index = index
        self.pdf_path = pdf_path
        self.on_remove = on_remove
        self.on_move_up = on_move_up
        self.on_move_down = on_move_down
        self._build()

    def _build(self):
        # Ligne principale du PDF
        row = tk.Frame(self, bg="#2d2d2d", pady=6, padx=8)
        row.pack(fill="x", pady=2)

        num = tk.Label(row, text=f"PDF {self.index + 1}", width=6,
                       bg="#2d2d2d", fg="#888888", font=("Segoe UI", 9, "bold"))
        num.pack(side="left")

        name = tk.Label(row, text=Path(self.pdf_path).name, anchor="w",
                        bg="#2d2d2d", fg="#dddddd", font=("Segoe UI", 9))
        name.pack(side="left", fill="x", expand=True, padx=8)

        btn_up = tk.Button(row, text="▲", command=self.on_move_up,
                           bg="#3a3a3a", fg="#aaaaaa", relief="flat",
                           font=("Segoe UI", 8), padx=4)
        btn_up.pack(side="left")

        btn_dn = tk.Button(row, text="▼", command=self.on_move_down,
                           bg="#3a3a3a", fg="#aaaaaa", relief="flat",
                           font=("Segoe UI", 8), padx=4)
        btn_dn.pack(side="left", padx=(2, 6))

        btn_rm = tk.Button(row, text="✕", command=self.on_remove,
                           bg="#5a2020", fg="#ff6b6b", relief="flat",
                           font=("Segoe UI", 9, "bold"), padx=6)
        btn_rm.pack(side="right")

    def update_index(self, index: int):
        self.index = index


# ─────────────────────────────────────────────
# Fenêtre de sélection de slide
# ─────────────────────────────────────────────

class SlidePickerDialog(tk.Toplevel):
    """Fenêtre modale pour choisir une slide à intercaler entre deux PDFs."""

    def __init__(self, parent, slide_page_pdfs: list[str],
                 current_selection: int | None, slot_label: str):
        super().__init__(parent)
        self.title(f"Choisir une slide — {slot_label}")
        self.configure(bg="#1e1e1e")
        self.resizable(True, True)
        self.geometry("860x500")
        self.grab_set()  # modal

        self.slide_pdfs = slide_page_pdfs
        self.result: int | None = current_selection
        self._thumb_refs = []
        self._thumb_buttons: list[ThumbnailButton] = []

        self._build(slot_label)
        self._load_thumbnails()

    def _build(self, slot_label: str):
        header = tk.Label(self, text=f"Sélectionner la slide à insérer après « {slot_label} »",
                          bg="#1e1e1e", fg="#ffffff",
                          font=("Segoe UI", 11, "bold"), pady=12)
        header.pack()

        # Zone scrollable
        container = tk.Frame(self, bg="#1e1e1e")
        container.pack(fill="both", expand=True, padx=12, pady=4)

        self.canvas = tk.Canvas(container, bg="#1e1e1e", highlightthickness=0)
        scrollbar = ttk.Scrollbar(container, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(xscrollcommand=scrollbar.set)

        scrollbar.pack(side="bottom", fill="x")
        self.canvas.pack(side="top", fill="both", expand=True)

        self.thumb_frame = tk.Frame(self.canvas, bg="#1e1e1e")
        self.canvas_window = self.canvas.create_window((0, 0), window=self.thumb_frame, anchor="nw")
        self.thumb_frame.bind("<Configure>", lambda e: self.canvas.configure(
            scrollregion=self.canvas.bbox("all")))

        # Boutons bas
        btn_row = tk.Frame(self, bg="#1e1e1e", pady=8)
        btn_row.pack()

        tk.Button(btn_row, text="Aucune slide (pas d'intercalaire)",
                  command=self._select_none,
                  bg="#3a3a3a", fg="#aaaaaa", relief="flat",
                  font=("Segoe UI", 9), padx=12, pady=6).pack(side="left", padx=8)

        tk.Button(btn_row, text="✓  Confirmer",
                  command=self._confirm,
                  bg="#2d6a2d", fg="white", relief="flat",
                  font=("Segoe UI", 10, "bold"), padx=16, pady=6).pack(side="left", padx=8)

    def _load_thumbnails(self):
        self.config(cursor="watch")
        self.update()

        for i, slide_pdf in enumerate(self.slide_pdfs):
            img = render_pdf_page_as_image(slide_pdf, 0, size=(160, 120))
            self._thumb_refs.append(img)

            btn = ThumbnailButton(
                self.thumb_frame, i, img,
                on_select=self._on_select,
                bg="#2b2b2b"
            )
            btn.pack(side="left", padx=6, pady=8)
            self._thumb_buttons.append(btn)

        if self.result is not None:
            self._highlight(self.result)

        self.config(cursor="")

    def _on_select(self, index: int):
        self.result = index
        self._highlight(index)

    def _highlight(self, index: int):
        for i, btn in enumerate(self._thumb_buttons):
            btn.set_selected(i == index)

    def _select_none(self):
        self.result = None
        for btn in self._thumb_buttons:
            btn.set_selected(False)

    def _confirm(self):
        self.destroy()


# ─────────────────────────────────────────────
# Application principale
# ─────────────────────────────────────────────

class App(tk.Tk):

    def __init__(self):
        super().__init__()
        self.title("PDF + PPTX Merger")
        self.geometry("900x700")
        self.configure(bg="#1e1e1e")
        self.minsize(700, 500)

        # État
        self.pptx_path: str | None = None
        self.slide_pdfs: list[str] = []        # un PDF par slide du PPTX
        self.pdf_slots: list[str] = []         # PDFs chargés par l'utilisateur
        # intercalaires[i] = index de slide à insérer APRÈS pdf_slots[i]
        # (None = pas de slide)
        self.intercalaires: list[int | None] = []
        self._tmpdir = tempfile.mkdtemp(prefix="pptx_merger_")

        self._build_ui()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ── Construction UI ──────────────────────

    def _build_ui(self):
        # Barre haute
        topbar = tk.Frame(self, bg="#252525", pady=10)
        topbar.pack(fill="x")

        tk.Label(topbar, text="PDF + PPTX Merger", bg="#252525", fg="white",
                 font=("Segoe UI", 14, "bold")).pack(side="left", padx=16)

        tk.Button(topbar, text="📄  Charger le PPTX",
                  command=self._load_pptx,
                  bg="#1a4a8a", fg="white", relief="flat",
                  font=("Segoe UI", 10), padx=14, pady=6).pack(side="left", padx=8)

        tk.Button(topbar, text="➕  Ajouter des PDFs",
                  command=self._add_pdfs,
                  bg="#2d6a2d", fg="white", relief="flat",
                  font=("Segoe UI", 10), padx=14, pady=6).pack(side="left", padx=4)

        self.generate_btn = tk.Button(topbar, text="⚙  Générer le PDF",
                                      command=self._generate,
                                      bg="#7a3a00", fg="white", relief="flat",
                                      font=("Segoe UI", 10, "bold"), padx=14, pady=6,
                                      state="disabled")
        self.generate_btn.pack(side="right", padx=16)

        # Statut PPTX
        self.pptx_label = tk.Label(self, text="Aucun PPTX chargé",
                                   bg="#1e1e1e", fg="#888888",
                                   font=("Segoe UI", 9, "italic"), pady=6)
        self.pptx_label.pack(fill="x", padx=16)

        # Séparateur
        ttk.Separator(self, orient="horizontal").pack(fill="x", padx=16)

        # Corps : liste PDFs + intercalaires
        body_container = tk.Frame(self, bg="#1e1e1e")
        body_container.pack(fill="both", expand=True, padx=16, pady=8)

        # Scrollbar verticale
        self.scrollbar = ttk.Scrollbar(body_container, orient="vertical")
        self.scrollbar.pack(side="right", fill="y")

        self.body_canvas = tk.Canvas(body_container, bg="#1e1e1e",
                                     highlightthickness=0,
                                     yscrollcommand=self.scrollbar.set)
        self.body_canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar.configure(command=self.body_canvas.yview)

        self.pdf_list_frame = tk.Frame(self.body_canvas, bg="#1e1e1e")
        self.body_canvas.create_window((0, 0), window=self.pdf_list_frame, anchor="nw")
        self.pdf_list_frame.bind("<Configure>", lambda e: self.body_canvas.configure(
            scrollregion=self.body_canvas.bbox("all")))

        self.body_canvas.bind("<MouseWheel>", lambda e: self.body_canvas.yview_scroll(
            -1 * (e.delta // 120), "units"))

        self._empty_label = tk.Label(self.pdf_list_frame,
                                     text="Ajoutez des PDFs avec le bouton ci-dessus.",
                                     bg="#1e1e1e", fg="#555555",
                                     font=("Segoe UI", 10, "italic"), pady=40)
        self._empty_label.pack()

        # Barre de statut
        self.status_bar = tk.Label(self, text="Prêt.",
                                   bg="#141414", fg="#888888",
                                   font=("Segoe UI", 8), anchor="w", padx=12, pady=4)
        self.status_bar.pack(fill="x", side="bottom")

    # ── Chargement PPTX ──────────────────────

    def _load_pptx(self):
        path = filedialog.askopenfilename(
            title="Sélectionner un fichier PowerPoint",
            filetypes=[("PowerPoint", "*.pptx *.ppt"), ("Tous les fichiers", "*.*")]
        )
        if not path:
            return
        self.pptx_path = path
        self.slide_pdfs = []
        self.pptx_label.configure(text=f"Conversion en cours : {Path(path).name} …",
                                   fg="#f0a020")
        self.update()
        self._set_status("Conversion PPTX → PDF via PowerPoint…")
        threading.Thread(target=self._convert_pptx_thread, daemon=True).start()

    def _convert_pptx_thread(self):
        try:
            merged_pdf = os.path.join(self._tmpdir, "slides_merged.pdf")
            convert_pptx_to_pdf(self.pptx_path, merged_pdf)
            # Découpe chaque slide en PDF individuel
            slides_dir = os.path.join(self._tmpdir, "slides")
            os.makedirs(slides_dir, exist_ok=True)
            slide_pdfs = split_pdf_into_pages(merged_pdf, slides_dir)
            self.after(0, self._on_pptx_loaded, slide_pdfs)
        except Exception as e:
            self.after(0, self._on_pptx_error, str(e))

    def _on_pptx_loaded(self, slide_pdfs: list[str]):
        self.slide_pdfs = slide_pdfs
        name = Path(self.pptx_path).name
        count = len(slide_pdfs)
        self.pptx_label.configure(
            text=f"✓  {name}  —  {count} slide{'s' if count > 1 else ''} chargée{'s' if count > 1 else ''}",
            fg="#4aaa4a"
        )
        self._set_status(f"PPTX converti : {count} slides disponibles.")
        self._refresh_intercalaire_buttons()
        self._check_generate_ready()

    def _on_pptx_error(self, error: str):
        self.pptx_label.configure(text=f"Erreur : {error}", fg="#ff4444")
        messagebox.showerror("Erreur PPTX", f"Impossible de convertir le PPTX :\n{error}\n\n"
                             "Vérifiez que Microsoft PowerPoint est bien installé.")
        self._set_status("Erreur lors de la conversion PPTX.")

    # ── Chargement PDFs ──────────────────────

    def _add_pdfs(self):
        paths = filedialog.askopenfilenames(
            title="Sélectionner des fichiers PDF",
            filetypes=[("PDF", "*.pdf"), ("Tous les fichiers", "*.*")]
        )
        if not paths:
            return
        for p in paths:
            self.pdf_slots.append(p)
            self.intercalaires.append(None)
        self._refresh_pdf_list()
        self._check_generate_ready()

    # ── Rafraîchissement UI ──────────────────

    def _refresh_pdf_list(self):
        for widget in self.pdf_list_frame.winfo_children():
            widget.destroy()

        if not self.pdf_slots:
            self._empty_label = tk.Label(self.pdf_list_frame,
                                         text="Ajoutez des PDFs avec le bouton ci-dessus.",
                                         bg="#1e1e1e", fg="#555555",
                                         font=("Segoe UI", 10, "italic"), pady=40)
            self._empty_label.pack()
            return

        for i, pdf_path in enumerate(self.pdf_slots):
            # Bloc PDF
            slot = tk.Frame(self.pdf_list_frame, bg="#2a2a2a", pady=6, padx=10)
            slot.pack(fill="x", pady=2)

            # Numéro
            tk.Label(slot, text=f"PDF {i + 1}", width=6, bg="#2a2a2a",
                     fg="#888888", font=("Segoe UI", 9, "bold")).pack(side="left")

            # Nom
            tk.Label(slot, text=Path(pdf_path).name, anchor="w", bg="#2a2a2a",
                     fg="#dddddd", font=("Segoe UI", 9)).pack(side="left", fill="x",
                                                               expand=True, padx=8)

            # Boutons réorganisation / suppression
            idx = i  # capture
            tk.Button(slot, text="▲",
                      command=lambda x=idx: self._move_up(x),
                      bg="#3a3a3a", fg="#aaaaaa", relief="flat",
                      font=("Segoe UI", 8), padx=4).pack(side="left")
            tk.Button(slot, text="▼",
                      command=lambda x=idx: self._move_down(x),
                      bg="#3a3a3a", fg="#aaaaaa", relief="flat",
                      font=("Segoe UI", 8), padx=4).pack(side="left", padx=(2, 6))
            tk.Button(slot, text="✕",
                      command=lambda x=idx: self._remove_pdf(x),
                      bg="#5a2020", fg="#ff6b6b", relief="flat",
                      font=("Segoe UI", 9, "bold"), padx=6).pack(side="right")

            # Intercalaire (sauf après le dernier PDF)
            if i < len(self.pdf_slots) - 1:
                self._build_intercalaire_row(i)

    def _build_intercalaire_row(self, after_index: int):
        """Ligne d'intercalaire entre pdf[after_index] et pdf[after_index+1]."""
        row = tk.Frame(self.pdf_list_frame, bg="#181818", pady=4)
        row.pack(fill="x", padx=32)

        tk.Label(row, text="↓", bg="#181818", fg="#555555",
                 font=("Segoe UI", 10)).pack(side="left", padx=8)

        sel = self.intercalaires[after_index]
        if sel is None:
            label_text = "— Aucune slide intercalée —"
            label_fg = "#555555"
        else:
            label_text = f"Slide {sel + 1} intercalée"
            label_fg = "#4a9eff"

        status_lbl = tk.Label(row, text=label_text, bg="#181818",
                              fg=label_fg, font=("Segoe UI", 9, "italic"))
        status_lbl.pack(side="left", padx=8)

        idx = after_index  # capture
        has_pptx = bool(self.slide_pdfs)
        btn_text = "Choisir une slide…" if has_pptx else "Charger d'abord le PPTX"
        tk.Button(row, text=btn_text,
                  command=(lambda x=idx: self._pick_slide(x)) if has_pptx else lambda: None,
                  state="normal" if has_pptx else "disabled",
                  bg="#1a4a8a" if has_pptx else "#333333",
                  fg="white", relief="flat",
                  font=("Segoe UI", 9), padx=10, pady=3).pack(side="right", padx=8)

        tk.Label(row, text="↓", bg="#181818", fg="#555555",
                 font=("Segoe UI", 10)).pack(side="right", padx=4)

    def _refresh_intercalaire_buttons(self):
        """Appelé quand le PPTX est chargé pour activer les boutons existants."""
        self._refresh_pdf_list()

    # ── Actions PDF ──────────────────────────

    def _move_up(self, index: int):
        if index == 0:
            return
        self.pdf_slots[index], self.pdf_slots[index - 1] = \
            self.pdf_slots[index - 1], self.pdf_slots[index]
        self.intercalaires[index], self.intercalaires[index - 1] = \
            self.intercalaires[index - 1], self.intercalaires[index]
        self._refresh_pdf_list()

    def _move_down(self, index: int):
        if index >= len(self.pdf_slots) - 1:
            return
        self.pdf_slots[index], self.pdf_slots[index + 1] = \
            self.pdf_slots[index + 1], self.pdf_slots[index]
        self.intercalaires[index], self.intercalaires[index + 1] = \
            self.intercalaires[index + 1], self.intercalaires[index]
        self._refresh_pdf_list()

    def _remove_pdf(self, index: int):
        self.pdf_slots.pop(index)
        self.intercalaires.pop(index)
        self._refresh_pdf_list()
        self._check_generate_ready()

    # ── Sélection de slide ───────────────────

    def _pick_slide(self, after_index: int):
        if not self.slide_pdfs:
            messagebox.showwarning("PPTX requis", "Veuillez d'abord charger un fichier PPTX.")
            return
        pdf_name = Path(self.pdf_slots[after_index]).stem
        dialog = SlidePickerDialog(
            self,
            self.slide_pdfs,
            self.intercalaires[after_index],
            slot_label=pdf_name
        )
        self.wait_window(dialog)
        self.intercalaires[after_index] = dialog.result
        self._refresh_pdf_list()

    # ── Génération ───────────────────────────

    def _check_generate_ready(self):
        ready = len(self.pdf_slots) >= 1
        self.generate_btn.configure(state="normal" if ready else "disabled",
                                    bg="#c05000" if ready else "#7a3a00")

    def _generate(self):
        if not self.pdf_slots:
            messagebox.showwarning("Rien à générer", "Ajoutez au moins un PDF.")
            return

        out_path = filedialog.asksaveasfilename(
            title="Enregistrer le PDF fusionné",
            defaultextension=".pdf",
            filetypes=[("PDF", "*.pdf")]
        )
        if not out_path:
            return

        self.generate_btn.configure(state="disabled", text="Génération…")
        self._set_status("Fusion en cours…")
        threading.Thread(target=self._generate_thread, args=(out_path,), daemon=True).start()

    def _generate_thread(self, out_path: str):
        try:
            writer = PdfWriter()

            for i, pdf_path in enumerate(self.pdf_slots):
                # Ajouter toutes les pages du PDF courant
                reader = PdfReader(pdf_path)
                for page in reader.pages:
                    writer.add_page(page)

                # Intercalaire après ce PDF (sauf après le dernier si aucun choisi)
                slide_index = self.intercalaires[i] if i < len(self.intercalaires) else None
                if slide_index is not None and slide_index < len(self.slide_pdfs):
                    slide_reader = PdfReader(self.slide_pdfs[slide_index])
                    for page in slide_reader.pages:
                        writer.add_page(page)

            with open(out_path, "wb") as f:
                writer.write(f)

            self.after(0, self._on_generate_done, out_path)
        except Exception as e:
            self.after(0, self._on_generate_error, str(e))

    def _on_generate_done(self, out_path: str):
        self.generate_btn.configure(state="normal", text="⚙  Générer le PDF",
                                    bg="#c05000")
        self._set_status(f"✓  PDF généré : {out_path}")
        messagebox.showinfo("Succès", f"PDF généré avec succès :\n{out_path}")

    def _on_generate_error(self, error: str):
        self.generate_btn.configure(state="normal", text="⚙  Générer le PDF",
                                    bg="#c05000")
        self._set_status(f"Erreur : {error}")
        messagebox.showerror("Erreur", f"Erreur lors de la génération :\n{error}")

    # ── Utilitaires ──────────────────────────

    def _set_status(self, msg: str):
        self.status_bar.configure(text=msg)
        self.update_idletasks()

    def _on_close(self):
        shutil.rmtree(self._tmpdir, ignore_errors=True)
        self.destroy()


# ─────────────────────────────────────────────
# Point d'entrée
# ─────────────────────────────────────────────

if __name__ == "__main__":
    app = App()
    app.mainloop()
