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
  },

  // PdfItemRow
  pdfItem: {
    openTooltip: "Double-clic pour ouvrir",
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
    merging: (done: number, total: number) => `Fusion… ${done}/${total}`,
    pdfSaved: (path: string) => `✓ PDF enregistré : ${path}`,
  },

  // Store — confirm dialogs
  confirm: {
    replacePptx: "Charger un nouveau PowerPoint remplacera toutes les diapositives existantes. Continuer ?",
    reuseOutput: (path: string) => `Réutiliser le fichier de sortie précédent ?\n${path}`,
  },
};
