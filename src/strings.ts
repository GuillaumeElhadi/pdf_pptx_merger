export const strings = {
  // TopBar
  topBar: {
    title: "PDF Merger",
    loadPptx: "📄 Ajout PowerPoint",
    loadPptxConverting: "Conversion…",
    loadPptxNoFile: "Aucun PowerPoint chargé",
    addPdfs: "＋ Ajouter des PDFs",
    generatePdf: "⚙ Générer PDF",
    generatePdfMerging: "Fusion…",
    googleDriveTooltip: (path: string) => `Ouvrir depuis Google Drive (${path})`,
  },

  // StatusBar
  statusBar: {
    dismiss: "Ignorer",
  },

  // MergeList
  mergeList: {
    empty: "Ajoutez des PDFs et chargez un PowerPoint, puis glissez-déposez pour les organiser.",
  },

  // SlideItemRow
  slideItem: {
    label: (n: number) => `Diapositive ${n}`,
    selectTooltip: "Clic pour désélectionner · Double-clic pour ouvrir",
    unselectTooltip: "Clic pour sélectionner · Shift+clic pour une plage · Double-clic pour ouvrir",
    followerTag: "suit le déplacement",
    removeTooltip: "Supprimer",
    rotateTooltip: "Rotation +90°",
    rotateTooltipMulti: (n: number) => `Rotation +90° (${n} sélectionnées)`,
  },

  // PdfItemRow
  pdfItem: {
    openTooltip: "Double-clic pour ouvrir",
    rotateTooltip: "Rotation +90°",
    rotateTooltipMulti: (n: number) => `Rotation +90° (${n} éléments sélectionnés)`,
  },

  // Store — status messages
  status: {
    ready: "Prêt.",
    converting: "Conversion du PowerPoint en cours…",
    pptxLoaded: (count: number) =>
      `PowerPoint chargé — ${count} diapositive${count !== 1 ? "s" : ""} disponible${count !== 1 ? "s" : ""}.`,
    pdfsAdded: (count: number) =>
      `${count} PDF${count !== 1 ? "s" : ""} ajouté${count !== 1 ? "s" : ""}.`,
    preparingMerge: "Préparation de la fusion…",
    merging: (done: number, total: number) => `Fusion… ${done}/${total} pages`,
    pdfSaved: (path: string) => `✓ PDF enregistré : ${path}`,
    mergingOwner: (index: number, total: number, name: string) =>
      `Fusion ${index}/${total} — ${name}…`,
    splitSaved: (count: number, dir: string) => `✓ ${count} PDFs enregistrés dans : ${dir}`,
    ownersNotReady: "Analyse des propriétaires en cours, veuillez réessayer dans un instant.",
  },

  // Store — confirm dialogs
  confirm: {
    replacePptx:
      "Charger un nouveau PowerPoint remplacera toutes les diapositives existantes. Continuer ?",
    reuseOutput: (path: string) => `Réutiliser le fichier de sortie précédent ?\n${path}`,
    reuseOutputSplit: (path: string) => `Réutiliser le dossier de sortie précédent ?\n${path}`,
  },
};
