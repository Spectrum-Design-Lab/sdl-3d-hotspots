import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";

/* ────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────── */

export interface BrowsableFile {
  id: string;
  typeName: string;
  name: string;
  alt: string | null;
  fileStatus: string;
  previewUrl: string | null;
}

export interface FolderSummary {
  id: string;
  name: string;
  assetCount: number;
  createdAt: string;
}

export interface FolderAsset {
  id: string;
  shopifyFileGid: string | null;
  originalFilename: string;
  url: string;
  kind: string;
  mimeType: string | null;
  createdAt: string;
}

type BrowserMode =
  | "model"        // single-select GLB/model files
  | "poster"       // single-select image files
  | "sequence";    // multi-select images for 360°

interface FileBrowserModalProps {
  open: boolean;
  onClose: () => void;
  mode: BrowserMode;
  /** initial file list from loader */
  initialFiles: BrowsableFile[];
  initialHasMore: boolean;
  initialCursor: string | null;
  /** currently selected file GID (single-select modes) */
  selectedGid?: string;
  /** callback when user confirms selection */
  onSelect: (gids: string[]) => void;
  /** callback when user uploads file(s) */
  onUpload: (files: FileList) => void;
  /** product GID and search query for fetcher hidden fields */
  productGid: string;
  q: string;
  /** busy state from parent actionFetcher */
  busy?: boolean;
  /** for poster: fallback images */
  shopLogoUrl?: string | null;
  productFeaturedImageUrl?: string | null;
  /** for sequence: zip upload handler */
  onZipUpload?: (file: File) => void;
  zipProcessing?: boolean;
  /** reference filename for loading related files first */
  referenceFilename?: string;
}

/* ────────────────────────────────────────────────────────────────────
 * Component
 * ──────────────────────────────────────────────────────────────────── */

export function FileBrowserModal({
  open,
  onClose,
  mode,
  initialFiles,
  initialHasMore,
  initialCursor,
  selectedGid,
  onSelect,
  onUpload,
  productGid,
  q,
  busy = false,
  shopLogoUrl,
  productFeaturedImageUrl,
  onZipUpload,
  zipProcessing = false,
  referenceFilename,
}: FileBrowserModalProps) {
  const isMulti = mode === "sequence";
  const fileType: "MODEL3D" | "IMAGE" = mode === "model" ? "MODEL3D" : "IMAGE";

  // ── Local state ──
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (isMulti) return new Set<string>();
    return selectedGid ? new Set([selectedGid]) : new Set<string>();
  });
  const [extraFiles, setExtraFiles] = useState<BrowsableFile[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchedFiles, setSearchedFiles] = useState<BrowsableFile[] | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // ── Folder state (unified directory view) ──
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(null);
  const [folderAssets, setFolderAssets] = useState<FolderAsset[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addToFolderMode, setAddToFolderMode] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setExtraFiles([]);
      setCursor(initialCursor);
      setHasMore(initialHasMore);
      setSearchTerm("");
      setSearchedFiles(null);
      setCurrentFolderId(null);
      setCurrentFolderName(null);
      setFolderAssets([]);
      setFoldersLoaded(false);
      setShowNewFolderInput(false);
      setNewFolderName("");
      setRenamingFolderId(null);
      setAddToFolderMode(false);
      if (isMulti) {
        setSelected(new Set());
      } else {
        setSelected(selectedGid ? new Set([selectedGid]) : new Set());
      }
    }
  }, [open, initialCursor, initialHasMore, selectedGid, isMulti]);

  // ── Fetchers ──
  const loadMoreFetcher = useFetcher<{
    ok?: boolean;
    fileType?: string;
    files?: BrowsableFile[];
    hasNextPage?: boolean;
    endCursor?: string | null;
  }>();

  const searchFetcher = useFetcher<{
    ok?: boolean;
    intent?: string;
    files?: BrowsableFile[];
  }>();

  const folderFetcher = useFetcher<{
    ok?: boolean;
    folders?: FolderSummary[];
    assets?: FolderAsset[];
    folder?: { id: string; name: string };
    message?: string;
    count?: number;
  }>();

  const autoSelectFetcher = useFetcher<{
    ok?: boolean;
    intent?: string;
    files?: BrowsableFile[];
    count?: number;
  }>();

  const relatedFetcher = useFetcher<{
    ok?: boolean;
    intent?: string;
    files?: BrowsableFile[];
    hasNextPage?: boolean;
    endCursor?: string | null;
  }>();

  const [relatedFiles, setRelatedFiles] = useState<BrowsableFile[] | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);

  // Load related files when modal opens with a reference filename
  useEffect(() => {
    if (open && referenceFilename && !showAllFiles) {
      const fd = new FormData();
      fd.set("intent", "loadRelatedFiles");
      fd.set("fileType", fileType);
      fd.set("referenceFilename", referenceFilename);
      relatedFetcher.submit(fd, { method: "post", action: "/api/sdl3d/files" });
    }
  }, [open, referenceFilename]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle related files response
  useEffect(() => {
    if (relatedFetcher.state !== "idle" || !relatedFetcher.data?.ok) return;
    setRelatedFiles(relatedFetcher.data.files || []);
  }, [relatedFetcher.state, relatedFetcher.data]);

  // Reset related state on modal open
  useEffect(() => {
    if (open) {
      setRelatedFiles(null);
      setShowAllFiles(false);
    }
  }, [open]);

  // Handle load-more results
  useEffect(() => {
    if (loadMoreFetcher.state !== "idle" || !loadMoreFetcher.data?.ok) return;
    const d = loadMoreFetcher.data;
    setExtraFiles((prev) => [...prev, ...(d.files || [])]);
    setCursor(d.endCursor || null);
    setHasMore(d.hasNextPage || false);
  }, [loadMoreFetcher.state, loadMoreFetcher.data]);

  // Handle search results
  useEffect(() => {
    if (searchFetcher.state !== "idle" || !searchFetcher.data?.ok) return;
    if (searchFetcher.data.intent === "searchFiles") {
      setSearchedFiles((searchFetcher.data.files || []) as BrowsableFile[]);
    }
  }, [searchFetcher.state, searchFetcher.data]);

  // Handle folder fetcher results
  useEffect(() => {
    if (folderFetcher.state !== "idle" || !folderFetcher.data?.ok) return;
    const d = folderFetcher.data;
    if (d.folders) {
      setFolders(d.folders);
      setFoldersLoaded(true);
    }
    if (d.assets) {
      setFolderAssets(d.assets);
    }
    if (d.folder) {
      // New folder created -- refresh list
      fetchFolders();
      setShowNewFolderInput(false);
      setNewFolderName("");
    }
    if (d.message && (d.message.includes("Renamed") || d.message.includes("deleted"))) {
      fetchFolders();
      setRenamingFolderId(null);
      if (d.message.includes("deleted")) {
        setCurrentFolderId(null);
        setCurrentFolderName(null);
        setFolderAssets([]);
      }
    }
    if (d.message && d.message.includes("Added")) {
      setAddToFolderMode(false);
      // Refresh folder contents if viewing one
      if (currentFolderId) fetchFolderContents(currentFolderId);
      fetchFolders();
    }
    if (d.message && d.message.includes("Removed")) {
      if (currentFolderId) fetchFolderContents(currentFolderId);
      fetchFolders();
    }
  }, [folderFetcher.state, folderFetcher.data]);

  const allFiles = useMemo(
    () => [...initialFiles, ...extraFiles],
    [initialFiles, extraFiles],
  );
  const displayFiles = searchedFiles ?? (relatedFiles && !showAllFiles ? relatedFiles : allFiles);

  // ── Folder helpers ──
  function fetchFolders() {
    const fd = new FormData();
    fd.set("intent", "listFolders");
    folderFetcher.submit(fd, { method: "post", action: "/api/sdl3d/folders" });
  }

  function fetchFolderContents(folderId: string) {
    const fd = new FormData();
    fd.set("intent", "getFolderContents");
    fd.set("folderId", folderId);
    folderFetcher.submit(fd, { method: "post", action: "/api/sdl3d/folders" });
  }

  function handleCreateFolder(name: string) {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("intent", "createFolder");
    fd.set("name", name.trim());
    folderFetcher.submit(fd, { method: "post", action: "/api/sdl3d/folders" });
  }

  function handleRenameFolder(folderId: string, name: string) {
    if (!name.trim()) return;
    const fd = new FormData();
    fd.set("intent", "renameFolder");
    fd.set("folderId", folderId);
    fd.set("name", name.trim());
    folderFetcher.submit(fd, { method: "post", action: "/api/sdl3d/folders" });
  }

  function handleDeleteFolder(folderId: string) {
    const fd = new FormData();
    fd.set("intent", "deleteFolder");
    fd.set("folderId", folderId);
    folderFetcher.submit(fd, { method: "post", action: "/api/sdl3d/folders" });
  }

  function handleAddSelectedToFolder(folderId: string) {
    const files = Array.from(selected).map((gid) => {
      const file = displayFiles.find((f) => f.id === gid);
      return {
        shopifyFileGid: gid,
        originalFilename: file?.name || "unknown",
        url: file?.previewUrl || "",
        kind: file?.typeName === "Model3d" ? "MODEL_3D" : "IMAGE",
      };
    });
    const fd = new FormData();
    fd.set("intent", "addToFolder");
    fd.set("folderId", folderId);
    fd.set("files", JSON.stringify(files));
    folderFetcher.submit(fd, { method: "post", action: "/api/sdl3d/folders" });
  }

  function handleRemoveFromFolder(assetIds: string[]) {
    const fd = new FormData();
    fd.set("intent", "removeFromFolder");
    fd.set("assetIds", JSON.stringify(assetIds));
    folderFetcher.submit(fd, { method: "post", action: "/api/sdl3d/folders" });
  }

  // Load folders when modal opens
  useEffect(() => {
    if (open && !foldersLoaded) {
      fetchFolders();
    }
  }, [open, foldersLoaded]);

  // ── Handlers ──
  const toggleFile = useCallback(
    (gid: string) => {
      setSelected((prev) => {
        if (isMulti) {
          const next = new Set(prev);
          if (next.has(gid)) next.delete(gid);
          else next.add(gid);
          return next;
        }
        // single-select: toggle on/off
        return prev.has(gid) ? new Set() : new Set([gid]);
      });
    },
    [isMulti],
  );

  const handleLoadMore = useCallback(() => {
    if (!cursor) return;
    const fd = new FormData();
    fd.set("intent", "loadMoreFiles");
    fd.set("fetcherMode", "1");
    fd.set("productGid", productGid);
    fd.set("q", q);
    fd.set("fileType", fileType);
    fd.set("cursor", cursor);
    loadMoreFetcher.submit(fd, { method: "post", action: "/api/sdl3d/files" });
  }, [cursor, fileType, productGid, q, loadMoreFetcher]);

  // Infinite scroll: observe sentinel element
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    if (!open || searchedFiles !== null || (relatedFiles && !showAllFiles)) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && cursor && loadMoreFetcher.state === "idle") {
          handleLoadMore();
        }
      },
      { rootMargin: "200px" },
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [open, hasMore, cursor, searchedFiles, loadMoreFetcher.state, handleLoadMore]);

  // Update observer when sentinel ref changes
  const setSentinelRef = useCallback((node: HTMLDivElement | null) => {
    sentinelRef.current = node;
    if (node && observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current.observe(node);
    }
  }, []);

  const handleSearch = useCallback(() => {
    if (!searchTerm.trim()) {
      setSearchedFiles(null);
      return;
    }
    const fd = new FormData();
    fd.set("intent", "searchFiles");
    fd.set("fetcherMode", "1");
    fd.set("productGid", productGid);
    fd.set("q", q);
    fd.set("searchTerm", searchTerm);
    fd.set("fileType", fileType);
    searchFetcher.submit(fd, { method: "post", action: "/api/sdl3d/files" });
  }, [searchTerm, fileType, productGid, q, searchFetcher]);

  const handleConfirm = useCallback(() => {
    onSelect(Array.from(selected));
    onClose();
  }, [selected, onSelect, onClose]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        onUpload(e.target.files);
        onClose();
      }
    },
    [onUpload, onClose],
  );

  const handleZipChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && onZipUpload) {
        onZipUpload(file);
        onClose();
      }
    },
    [onZipUpload, onClose],
  );

  // Auto-select by prefix (sequence mode) — API-backed to find ALL matching files
  const autoSelectByPrefix = useCallback(() => {
    if (!searchTerm.trim()) return;
    const fd = new FormData();
    fd.set("intent", "autoSelectByPrefix");
    fd.set("fileType", fileType);
    fd.set("prefix", searchTerm.trim());
    autoSelectFetcher.submit(fd, { method: "post", action: "/api/sdl3d/files" });
  }, [searchTerm, fileType, autoSelectFetcher]);

  // Handle auto-select results
  useEffect(() => {
    if (autoSelectFetcher.state !== "idle" || !autoSelectFetcher.data?.ok) return;
    const files = autoSelectFetcher.data.files || [];
    if (files.length > 0) {
      // Merge new files into extraFiles (dedup by id)
      setExtraFiles((prev) => {
        const existingIds = new Set([...initialFiles.map((f) => f.id), ...prev.map((f) => f.id)]);
        const newFiles = files.filter((f) => !existingIds.has(f.id));
        return [...prev, ...newFiles];
      });
      // Select all matching
      setSelected(new Set(files.map((f) => f.id)));
    }
  }, [autoSelectFetcher.state, autoSelectFetcher.data, initialFiles]);

  // Esc key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const title =
    mode === "model"
      ? "Select 3D Model"
      : mode === "poster"
        ? "Select Poster Image"
        : "Select 360° Image Sequence";

  const accept =
    mode === "model"
      ? ".glb,.gltf,model/gltf-binary"
      : "image/*";

  const selectedFile = !isMulti && selected.size === 1
    ? displayFiles.find((f) => selected.has(f.id)) ?? allFiles.find((f) => selected.has(f.id))
    : null;

  const folderBusy = folderFetcher.state !== "idle";

  // Convert folder assets to BrowsableFile format for selection
  const folderDisplayFiles: BrowsableFile[] = folderAssets.map((a) => ({
    id: a.shopifyFileGid || a.id,
    typeName: a.kind === "MODEL_3D" ? "Model3d" : "MediaImage",
    name: a.originalFilename,
    alt: null,
    fileStatus: "READY",
    previewUrl: a.url || null,
  }));

  /* ────────────────────────────────────────────────────────────────
   * Render: Folder contents (folder open)
   * ──────────────────────────────────────────────────────────────── */
  function renderFolderContents() {
    return (
      <>
        <div className={`sdl-modal__body sdl-modal__body--${viewMode}`}>
          {folderAssets.length === 0 && !folderBusy ? (
            <div className="sdl-modal__empty">
              This folder is empty. Select files and use "Add to Folder".
            </div>
          ) : (
            folderDisplayFiles.map((file) => {
              const isSelected = selected.has(file.id);
              return (
                <button
                  key={file.id}
                  type="button"
                  className={`sdl-modal__file ${isSelected ? "sdl-modal__file--selected" : ""}`}
                  onClick={() => toggleFile(file.id)}
                >
                  <div className="sdl-modal__file-thumb">
                    {file.previewUrl ? (
                      <img src={file.previewUrl} alt={file.alt || file.name} loading="lazy" />
                    ) : (
                      <div className="sdl-modal__file-icon">
                        {mode === "model" ? "📦" : "🖼"}
                      </div>
                    )}
                    {isMulti && (
                      <div className={`sdl-modal__file-check ${isSelected ? "sdl-modal__file-check--on" : ""}`}>
                        {isSelected ? "✓" : ""}
                      </div>
                    )}
                  </div>
                  <div className="sdl-modal__file-name" title={file.name}>
                    {file.name}
                  </div>
                  <div className="sdl-modal__file-status">
                    {file.fileStatus}
                  </div>
                </button>
              );
            })
          )}
          {folderBusy && folderAssets.length === 0 && (
            <div className="sdl-modal__empty">Loading…</div>
          )}
        </div>
        {/* Remove from folder action */}
        {selected.size > 0 && currentFolderId && (
          <div className="sdl-modal__folder-actions-bar">
            <button
              type="button"
              className="sdl-btn sdl-btn--sm sdl-btn--danger"
              onClick={() => {
                const assetIdsToRemove = folderAssets
                  .filter((a) => selected.has(a.shopifyFileGid || a.id))
                  .map((a) => a.id);
                if (assetIdsToRemove.length) {
                  handleRemoveFromFolder(assetIdsToRemove);
                  setSelected(new Set());
                }
              }}
              disabled={folderBusy}
            >
              Remove {selected.size} from folder
            </button>
          </div>
        )}
      </>
    );
  }

  /* ────────────────────────────────────────────────────────────────
   * Render: Unified directory view (folders + files together)
   * ──────────────────────────────────────────────────────────────── */
  function renderDirectoryView() {
    const showFolders = !searchedFiles && folders.length > 0;
    return (
      <>
        {relatedFiles && !searchedFiles && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", fontSize: 13 }}>
            <span className="sdl-text-muted">
              {showAllFiles ? "Showing all files" : `Showing related files (${relatedFiles.length})`}
            </span>
            <button
              type="button"
              className="sdl-btn sdl-btn--xs"
              onClick={() => setShowAllFiles((v) => !v)}
            >
              {showAllFiles ? "Show related" : "Show all files"}
            </button>
          </div>
        )}
        <div className={`sdl-modal__body sdl-modal__body--${viewMode}`}>
          {/* Folders shown inline at top */}
          {showFolders && folders.map((folder) => (
            <div key={`folder-${folder.id}`} className="sdl-modal__folder-card">
              {renamingFolderId === folder.id ? (
                <div className="sdl-modal__folder-rename">
                  <input
                    type="text"
                    className="sdl-input sdl-input--sm"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameFolder(folder.id, renameValue);
                      if (e.key === "Escape") setRenamingFolderId(null);
                    }}
                    autoFocus
                  />
                  <div className="sdl-modal__folder-rename-actions">
                    <button type="button" className="sdl-btn sdl-btn--primary sdl-btn--xs" onClick={() => handleRenameFolder(folder.id, renameValue)} disabled={folderBusy}>Save</button>
                    <button type="button" className="sdl-btn sdl-btn--xs" onClick={() => setRenamingFolderId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="sdl-modal__folder-open"
                    onClick={() => {
                      if (addToFolderMode) {
                        handleAddSelectedToFolder(folder.id);
                        setAddToFolderMode(false);
                        return;
                      }
                      setCurrentFolderId(folder.id);
                      setCurrentFolderName(folder.name);
                      fetchFolderContents(folder.id);
                    }}
                  >
                    <div className="sdl-modal__folder-icon">&#128193;</div>
                    <div className="sdl-modal__folder-name">{folder.name}</div>
                    <div className="sdl-modal__folder-count">
                      {addToFolderMode
                        ? `Add ${selected.size} file${selected.size !== 1 ? "s" : ""} here`
                        : `${folder.assetCount} file${folder.assetCount !== 1 ? "s" : ""}`}
                    </div>
                  </button>
                  {!addToFolderMode && (
                    <div className="sdl-modal__folder-menu">
                      <button type="button" className="sdl-btn sdl-btn--xs" onClick={() => { setRenamingFolderId(folder.id); setRenameValue(folder.name); }} title="Rename">Rename</button>
                      <button type="button" className="sdl-btn sdl-btn--xs sdl-btn--danger" onClick={() => { if (confirm(`Delete folder "${folder.name}"? Files will not be deleted from Shopify.`)) handleDeleteFolder(folder.id); }} title="Delete">Delete</button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {/* Files */}
          {displayFiles.length === 0 && !showFolders ? (
            <div className="sdl-modal__empty">
              {searchedFiles !== null ? "No files match the search." : "No files found."}
            </div>
          ) : (
            displayFiles.map((file) => {
              const isSelected = selected.has(file.id);
              return (
                <button
                  key={file.id}
                  type="button"
                  className={`sdl-modal__file ${isSelected ? "sdl-modal__file--selected" : ""}`}
                  onClick={() => toggleFile(file.id)}
                >
                  <div className="sdl-modal__file-thumb">
                    {file.previewUrl ? (
                      <img src={file.previewUrl} alt={file.alt || file.name} loading="lazy" />
                    ) : (
                      <div className="sdl-modal__file-icon">
                        {mode === "model" ? "\u{1F4E6}" : "\u{1F5BC}"}
                      </div>
                    )}
                    {isMulti && (
                      <div className={`sdl-modal__file-check ${isSelected ? "sdl-modal__file-check--on" : ""}`}>
                        {isSelected ? "\u2713" : ""}
                      </div>
                    )}
                  </div>
                  <div className="sdl-modal__file-name" title={file.name}>
                    {file.name}
                  </div>
                  <div className="sdl-modal__file-status">
                    {file.fileStatus}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Infinite scroll sentinel */}
        {!searchedFiles && hasMore && (
          <div ref={setSentinelRef} className="sdl-modal__load-more">
            {loadMoreFetcher.state !== "idle" && (
              <div className="sdl-text-muted" style={{ padding: "8px 0", textAlign: "center" }}>Loading more files…</div>
            )}
          </div>
        )}
      </>
    );
  }

  /* ────────────────────────────────────────────────────────────────
   * Render: Add to Folder dropdown
   * ──────────────────────────────────────────────────────────────── */

  return (
    <div className="sdl-modal-overlay" onClick={onClose}>
      <div className="sdl-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="sdl-modal__header">
          <div className="sdl-modal__title">{title}</div>
          <div className="sdl-modal__header-actions">
            <div className="sdl-modal__view-toggle">
              <button
                type="button"
                className={`sdl-modal__view-btn ${viewMode === "grid" ? "sdl-modal__view-btn--active" : ""}`}
                onClick={() => setViewMode("grid")}
                title="Grid view"
              >
                ⊞
              </button>
              <button
                type="button"
                className={`sdl-modal__view-btn ${viewMode === "list" ? "sdl-modal__view-btn--active" : ""}`}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                ≡
              </button>
            </div>
            <button type="button" className="sdl-modal__close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* ── Toolbar: search + upload ── */}
        {!currentFolderId && (
          <div className="sdl-modal__toolbar">
            <div className="sdl-modal__search">
              <input
                type="text"
                className="sdl-input"
                placeholder="&#128269; Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
              />
              <button
                type="button"
                className="sdl-btn sdl-btn--primary sdl-btn--sm"
                onClick={handleSearch}
                disabled={searchFetcher.state !== "idle"}
              >
                {searchFetcher.state !== "idle" ? "…" : "Search"}
              </button>
              {searchedFiles && (
                <button
                  type="button"
                  className="sdl-btn sdl-btn--sm"
                  onClick={() => setSearchedFiles(null)}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="sdl-modal__upload-actions">
              {showNewFolderInput ? (
                <>
                  <input
                    type="text"
                    className="sdl-input sdl-input--sm"
                    placeholder="Folder name…"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder(newFolderName);
                      if (e.key === "Escape") {
                        setShowNewFolderInput(false);
                        setNewFolderName("");
                      }
                    }}
                    autoFocus
                    style={{ width: 140 }}
                  />
                  <button
                    type="button"
                    className="sdl-btn sdl-btn--primary sdl-btn--sm"
                    onClick={() => handleCreateFolder(newFolderName)}
                    disabled={!newFolderName.trim() || folderBusy}
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    className="sdl-btn sdl-btn--sm"
                    onClick={() => {
                      setShowNewFolderInput(false);
                      setNewFolderName("");
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="sdl-btn sdl-btn--sm"
                  onClick={() => setShowNewFolderInput(true)}
                >
                  + New Folder
                </button>
              )}
              <button
                type="button"
                className="sdl-btn sdl-btn--sm"
                onClick={handleUploadClick}
                disabled={busy}
              >
                Upload {mode === "model" ? "Model" : mode === "sequence" ? "Images" : "Image"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                multiple={isMulti}
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              {mode === "sequence" && (
                <>
                  <button
                    type="button"
                    className="sdl-btn sdl-btn--sm"
                    onClick={() => zipInputRef.current?.click()}
                    disabled={busy || zipProcessing}
                  >
                    {zipProcessing ? "Extracting…" : "Upload ZIP"}
                  </button>
                  <input
                    ref={zipInputRef}
                    type="file"
                    accept=".zip"
                    style={{ display: "none" }}
                    onChange={handleZipChange}
                  />
                </>
              )}
              {isMulti && (
                <>
                  <button
                    type="button"
                    className="sdl-btn sdl-btn--sm"
                    onClick={() => {
                      if (!searchTerm.trim()) {
                        const input = document.querySelector<HTMLInputElement>(".sdl-modal__search .sdl-input");
                        input?.focus();
                        return;
                      }
                      autoSelectByPrefix();
                    }}
                    disabled={autoSelectFetcher.state !== "idle"}
                  >
                    {autoSelectFetcher.state !== "idle" ? "Finding..." : "Auto-select matching"}
                  </button>
                  <button
                    type="button"
                    className="sdl-btn sdl-btn--sm"
                    onClick={() => setSelected(new Set())}
                    disabled={selected.size === 0}
                  >
                    Clear selection
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Breadcrumb when inside a folder ── */}
        {currentFolderId && (
          <div className="sdl-modal__toolbar">
            <div className="sdl-modal__breadcrumb" style={{ borderBottom: "none", padding: 0 }}>
              <button
                type="button"
                className="sdl-modal__breadcrumb-back"
                onClick={() => {
                  setCurrentFolderId(null);
                  setCurrentFolderName(null);
                  setFolderAssets([]);
                  setSelected(new Set());
                }}
              >
                ← All Files
              </button>
              <span className="sdl-modal__breadcrumb-sep">/</span>
              <span className="sdl-modal__breadcrumb-current">{currentFolderName}</span>
            </div>
          </div>
        )}

        {/* ── Add-to-folder bar ── */}
        {addToFolderMode && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 20px", borderBottom: "1px solid var(--border-soft, #e5e7eb)", fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>
              Select a folder for {selected.size} file{selected.size !== 1 ? "s" : ""}:
            </span>
            <button
              type="button"
              className="sdl-btn sdl-btn--sm"
              onClick={() => setAddToFolderMode(false)}
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── Main content area: unified directory view ── */}
        {!currentFolderId && renderDirectoryView()}
        {currentFolderId && renderFolderContents()}

        {/* ── Footer ── */}
        <div className="sdl-modal__footer">
          <div className="sdl-modal__footer-info">
            {isMulti ? (
              <span>{selected.size} file{selected.size !== 1 ? "s" : ""} selected</span>
            ) : selectedFile ? (
              <span>
                Selected: <strong>{selectedFile.name}</strong>
                {selectedFile.fileStatus !== "READY" && (
                  <span className="sdl-text-muted"> · {selectedFile.fileStatus}</span>
                )}
              </span>
            ) : (
              <span className="sdl-text-muted">No file selected</span>
            )}
          </div>
          <div className="sdl-modal__footer-actions" style={{ position: "relative" }}>
            {/* Add to Folder button */}
            {!currentFolderId && selected.size > 0 && !addToFolderMode && (
              <button
                type="button"
                className="sdl-btn sdl-btn--sm"
                onClick={() => {
                  setAddToFolderMode(true);
                  if (!foldersLoaded) fetchFolders();
                }}
              >
                Add to Folder
              </button>
            )}
            {!isMulti && selectedGid && (
              <button
                type="button"
                className="sdl-btn sdl-btn--sm"
                onClick={() => {
                  onSelect([]);
                  onClose();
                }}
              >
                Clear selection
              </button>
            )}
            <button type="button" className="sdl-btn sdl-btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="sdl-btn sdl-btn--primary sdl-btn--sm"
              onClick={handleConfirm}
              disabled={selected.size === 0 || busy}
            >
              {isMulti ? `Use ${selected.size} file${selected.size !== 1 ? "s" : ""} as sequence` : "Select"}
            </button>
          </div>
        </div>

        {/* Poster fallback info */}
        {mode === "poster" && !selectedFile && (shopLogoUrl || productFeaturedImageUrl) && (
          <div className="sdl-modal__poster-fallbacks">
            {shopLogoUrl && (
              <div className="sdl-modal__poster-fallback">
                <img src={shopLogoUrl} alt="Shop logo" />
                <span>Shop logo shown while loading</span>
              </div>
            )}
            {productFeaturedImageUrl && (
              <div className="sdl-modal__poster-fallback">
                <img src={productFeaturedImageUrl} alt="Product" />
                <span>Product image used as fallback</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
