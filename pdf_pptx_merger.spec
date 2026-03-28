# pdf_pptx_merger.spec
# Générer l'exe : pyinstaller pdf_pptx_merger.spec
#
# PRÉREQUIS : Poppler pour Windows doit être installé sur la machine de BUILD.
# Télécharger : https://github.com/oschwartz10612/poppler-windows/releases
# Extraire dans C:\poppler\
# Adapter POPPLER_BIN_PATH ci-dessous si le chemin diffère.

import os
from pathlib import Path

block_cipher = None

# ── Chemin vers les binaires Poppler sur la machine de BUILD ──────────────────
POPPLER_BIN_PATH = r"C:\poppler\Library\bin"

if not os.path.isdir(POPPLER_BIN_PATH):
    raise RuntimeError(
        f"Poppler introuvable : {POPPLER_BIN_PATH}\n"
        "Téléchargez Poppler depuis https://github.com/oschwartz10612/poppler-windows/releases\n"
        "et adaptez POPPLER_BIN_PATH dans le fichier .spec."
    )

# Collecter tous les .dll et .exe de Poppler à embarquer dans l'exe
poppler_binaries = [
    (str(p), "poppler_bin")
    for p in Path(POPPLER_BIN_PATH).glob("*")
    if p.suffix.lower() in (".dll", ".exe")
]

# ── Runtime hook : redirige pdf2image vers les binaires embarqués ─────────────
# Ce fichier sera exécuté avant app.py au démarrage de l'exe.
runtime_hook_content = r"""
import os
import sys

# Quand PyInstaller extrait les fichiers, ils sont dans sys._MEIPASS
# On expose le sous-dossier poppler_bin comme chemin Poppler.
if hasattr(sys, '_MEIPASS'):
    poppler_dir = os.path.join(sys._MEIPASS, 'poppler_bin')
    # pdf2image accepte poppler_path en argument, mais on injecte aussi dans PATH
    # pour les cas où d'autres outils le cherchent directement.
    os.environ['PATH'] = poppler_dir + os.pathsep + os.environ.get('PATH', '')
    # Variable lue par notre app.py pour passer à pdf2image explicitement
    os.environ['POPPLER_PATH'] = poppler_dir
"""

runtime_hook_path = "runtime_hook_poppler.py"
with open(runtime_hook_path, "w") as f:
    f.write(runtime_hook_content)

# ─────────────────────────────────────────────────────────────────────────────

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=poppler_binaries,
    datas=[],
    hiddenimports=[
        'comtypes',
        'comtypes.client',
        'comtypes.server',
        'win32com',
        'win32com.client',
        'pywintypes',
        'pypdf',
        'PIL',
        'PIL._tkinter_finder',
        'pdf2image',
        'pdf2image.pdf2image',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[runtime_hook_path],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='PDFPPTXMerger',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # Pas de fenêtre console
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,              # Ajouter un .ico ici si souhaité
)
