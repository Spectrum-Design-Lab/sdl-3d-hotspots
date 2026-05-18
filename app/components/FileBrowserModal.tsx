/**
 * File picker modal — Polaris chrome migration (Slice 5C PR #5f).
 *
 * Mode-aware modal for picking a 3D model, poster image, or 360° image
 * sequence. Wraps everything in a Polaris `Modal` so escape/focus
 * trap/backdrop are owned by Polaris, and replaces the bespoke
 * `.sdl-modal__header` / `.sdl-modal__toolbar` / `.sdl-modal__footer`
 * chrome with Polaris primitives (TextField, Button, ButtonGroup,
 * Banner, Box, BlockStack, InlineStack).
 *
 * **Scope note**: the inner file-thumbnail grid (`.sdl-modal__file`) and
 * folder-card grid (`.sdl-modal__folder-card`) intentionally stay on
 * bespoke CSS classes here — they're a custom thumbnail-first layout
 * that doesn't map cleanly to Polaris `ResourceList` (row-based) or
 * `MediaCard` (single-tile). A follow-up PR can convert them to a
 * Polaris `InlineGrid` of small `Card` tiles; that change is independent
 * of this chrome migration and big enough to deserve its own commit.
 *
 * Grid/list view toggle dropped per Slice 5C decision #6 — consistent
 * with how `ProductBrowserModal` migrated in PR #5e. Grid is the canonical
 * view since file pickers are thumbnail-first.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  InlineStack,
  Modal,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";

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
  initialFiles: BrowsableFile[];
  initialHasMore: boolean;
  initialCursor: string | null;
  selectedGid?: string;
  onSelect: (gids: string[]) => void;
  onUpload: (files: FileList) => void;
  productGid: string;
  q: string;
  busy?: boolean;
  shopLogoUrl?: string | null;
  productFeaturedImageUrl?: string | null;
  onZipUpload?: (file: File) => void;
  zipProcessing?: boolean;
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

  useEffect(() => {
    if (relatedFetcher.state !== "idle" || !relatedFetcher.data?.ok) return;
    setRelatedFiles(relatedFetcher.data.files || []);
  }, [relatedFetcher.state, relatedFetcher.data]);

  useEffect(() => {
    if (open) {
      setRelatedFiles(null);
      setShowAllFiles(false);
    }
  }, [open]);

  useEffect(() => {
    if (loadMoreFetcher.state !== "idle" || !loadMoreFetcher.data?.ok) return;
    const d = loadMoreFetcher.data;
    setExtraFiles((prev) => [...prev, ...(d.files || [])]);
    setCursor(d.endCursor || null);
    setHasMore(d.hasNextPage || false);
  }, [loadMoreFetcher.state, loadMoreFetcher.data]);

  useEffect(() => {
    if (searchFetcher.state !== "idle" || !searchFetcher.data?.ok) return;
    if (searchFetcher.data.intent === "searchFiles") {
      setSearchedFiles((searchFetcher.data.files || []) as BrowsableFile[]);
    }
  }, [searchFetcher.state, searchFetcher.data]);

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
      if (currentFolderId) fetchFolderContents(currentFolderId);
      fetchFolders();
    }
    if (d.message && d.message.includes("Removed")) {
      if (currentFolderId) fetchFolderContents(currentFolderId);
      fetchFolders();
    }
  }, [folderFetcher.state, folderFetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (open && !foldersLoaded) {
      fetchFolders();
    }
  }, [open, foldersLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [open, hasMore, cursor, searchedFiles, relatedFiles, showAllFiles, loadMoreFetcher.state, handleLoadMore]);

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

  const autoSelectByPrefix = useCallback(() => {
    if (!searchTerm.trim()) return;
    const fd = new FormData();
    fd.set("intent", "autoSelectByPrefix");
    fd.set("fileType", fileType);
    fd.set("prefix", searchTerm.trim());
    autoSelectFetcher.submit(fd, { method: "post", action: "/api/sdl3d/files" });
  }, [searchTerm, fileType, autoSelectFetcher]);

  useEffect(() => {
    if (autoSelectFetcher.state !== "idle" || !autoSelectFetcher.data?.ok) return;
    const files = autoSelectFetcher.data.files || [];
    if (files.length > 0) {
      setExtraFiles((prev) => {
        const existingIds = new Set([...initialFiles.map((f) => f.id), ...prev.map((f) => f.id)]);
        const newFiles = files.filter((f) => !existingIds.has(f.id));
        return [...prev, ...newFiles];
      });
      setSelected(new Set(files.map((f) => f.id)));
    }
  }, [autoSelectFetcher.state, autoSelectFetcher.data, initialFiles]);

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

  const folderDisplayFiles: BrowsableFile[] = folderAssets.map((a) => ({
    id: a.shopifyFileGid || a.id,
    typeName: a.kind === "MODEL_3D" ? "Model3d" : "MediaImage",
    name: a.originalFilename,
    alt: null,
    fileStatus: "READY",
    previewUrl: a.url || null,
  }));

  const confirmLabel = isMulti
    ? `Use ${selected.size} file${selected.size !== 1 ? "s" : ""} as sequence`
    : "Select";

  /* ────────────────────────────────────────────────────────────────
   * Render: file card grid (folder contents or directory)
   * Bespoke `.sdl-modal__file*` classes preserved — full Polaris-card
   * grid migration is a follow-up PR.
   * ──────────────────────────────────────────────────────────────── */
  function renderFileGrid(files: BrowsableFile[], emptyText: string) {
    if (files.length === 0) {
      return (
        <Box padding="400">
          <Text as="p" tone="subdued" alignment="center">
            {emptyText}
          </Text>
        </Box>
      );
    }
    return (
      <div className="sdl-modal__body sdl-modal__body--grid">
        {files.map((file) => {
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
        })}
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="large"
      primaryAction={{
        content: confirmLabel,
        onAction: handleConfirm,
        disabled: selected.size === 0 || busy,
      }}
      secondaryActions={[
        ...(!isMulti && selectedGid
          ? [{
              content: "Clear selection",
              onAction: () => {
                onSelect([]);
                onClose();
              },
            }]
          : []),
        { content: "Cancel", onAction: onClose },
      ]}
    >
      {/* ── Toolbar (top section) ── */}
      <Modal.Section>
        {currentFolderId ? (
          // Breadcrumb when inside a folder
          <InlineStack gap="200" blockAlign="center">
            <Button
              variant="plain"
              onClick={() => {
                setCurrentFolderId(null);
                setCurrentFolderName(null);
                setFolderAssets([]);
                setSelected(new Set());
              }}
            >
              ← All Files
            </Button>
            <Text as="span" tone="subdued">/</Text>
            <Text as="span" fontWeight="semibold">{currentFolderName}</Text>
          </InlineStack>
        ) : (
          <BlockStack gap="300">
            {/* Search row */}
            <InlineStack gap="200" blockAlign="end">
              <Box width="100%">
                <TextField
                  label="Search"
                  labelHidden
                  value={searchTerm}
                  onChange={setSearchTerm}
                  onFocus={() => { /* no-op */ }}
                  placeholder="Search files"
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => {
                    setSearchTerm("");
                    setSearchedFiles(null);
                  }}
                />
              </Box>
              <Button
                variant="primary"
                onClick={handleSearch}
                loading={searchFetcher.state !== "idle"}
              >
                Search
              </Button>
            </InlineStack>

            {/* Upload + folder action row */}
            <InlineStack gap="200" wrap>
              {showNewFolderInput ? (
                <InlineStack gap="200" blockAlign="end">
                  <Box minWidth="160px">
                    <TextField
                      label="Folder name"
                      labelHidden
                      value={newFolderName}
                      onChange={setNewFolderName}
                      placeholder="Folder name…"
                      autoComplete="off"
                      autoFocus
                    />
                  </Box>
                  <Button
                    variant="primary"
                    onClick={() => handleCreateFolder(newFolderName)}
                    disabled={!newFolderName.trim() || folderBusy}
                  >
                    Create
                  </Button>
                  <Button
                    onClick={() => {
                      setShowNewFolderInput(false);
                      setNewFolderName("");
                    }}
                  >
                    Cancel
                  </Button>
                </InlineStack>
              ) : (
                <ButtonGroup>
                  <Button onClick={() => setShowNewFolderInput(true)}>+ New Folder</Button>
                  <Button onClick={handleUploadClick} disabled={busy}>
                    Upload {mode === "model" ? "Model" : mode === "sequence" ? "Images" : "Image"}
                  </Button>
                  {mode === "sequence" && (
                    <Button
                      onClick={() => zipInputRef.current?.click()}
                      disabled={busy || zipProcessing}
                      loading={zipProcessing}
                    >
                      Upload ZIP
                    </Button>
                  )}
                  {isMulti && (
                    <>
                      <Button
                        onClick={autoSelectByPrefix}
                        disabled={autoSelectFetcher.state !== "idle" || !searchTerm.trim()}
                        loading={autoSelectFetcher.state !== "idle"}
                      >
                        Auto-select matching
                      </Button>
                      <Button
                        onClick={() => setSelected(new Set())}
                        disabled={selected.size === 0}
                      >
                        Clear selection
                      </Button>
                    </>
                  )}
                </ButtonGroup>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                multiple={isMulti}
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              {mode === "sequence" && (
                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip"
                  style={{ display: "none" }}
                  onChange={handleZipChange}
                />
              )}
            </InlineStack>

            {/* Related-files banner */}
            {relatedFiles && !searchedFiles ? (
              <Banner tone="info">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodySm">
                    {showAllFiles
                      ? "Showing all files"
                      : `Showing files related to your current selection (${relatedFiles.length})`}
                  </Text>
                  <Button
                    variant="plain"
                    size="micro"
                    onClick={() => setShowAllFiles((v) => !v)}
                  >
                    {showAllFiles ? "Show related" : "Show all files"}
                  </Button>
                </InlineStack>
              </Banner>
            ) : null}

            {/* Add-to-folder banner */}
            {addToFolderMode ? (
              <Banner tone="info">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodySm">
                    Select a folder for {selected.size} file{selected.size !== 1 ? "s" : ""}:
                  </Text>
                  <Button
                    variant="plain"
                    size="micro"
                    onClick={() => setAddToFolderMode(false)}
                  >
                    Cancel
                  </Button>
                </InlineStack>
              </Banner>
            ) : null}

            {/* Selection summary + Add-to-Folder shortcut */}
            <InlineStack gap="300" align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone={selected.size > 0 ? "base" : "subdued"}>
                {isMulti ? (
                  `${selected.size} file${selected.size !== 1 ? "s" : ""} selected`
                ) : selectedFile ? (
                  <>Selected: <strong>{selectedFile.name}</strong>{selectedFile.fileStatus !== "READY" ? ` · ${selectedFile.fileStatus}` : ""}</>
                ) : (
                  "No file selected"
                )}
              </Text>
              {!currentFolderId && selected.size > 0 && !addToFolderMode ? (
                <Button
                  size="slim"
                  onClick={() => {
                    setAddToFolderMode(true);
                    if (!foldersLoaded) fetchFolders();
                  }}
                >
                  Add to Folder
                </Button>
              ) : null}
            </InlineStack>
          </BlockStack>
        )}
      </Modal.Section>

      {/* ── Body: folders + files grid ── */}
      <Modal.Section>
        {currentFolderId ? (
          // Folder contents view
          <BlockStack gap="200">
            {renderFileGrid(folderDisplayFiles, "This folder is empty. Select files and use \"Add to Folder\".")}
            {folderBusy && folderDisplayFiles.length === 0 ? (
              <InlineStack align="center">
                <Spinner size="small" accessibilityLabel="Loading" />
              </InlineStack>
            ) : null}
            {selected.size > 0 && currentFolderId ? (
              <InlineStack align="end">
                <Button
                  tone="critical"
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
                </Button>
              </InlineStack>
            ) : null}
          </BlockStack>
        ) : (
          // Directory view: folders inline above file grid
          <BlockStack gap="200">
            {!searchedFiles && folders.length > 0 ? (
              <div className="sdl-modal__body sdl-modal__body--grid">
                {folders.map((folder) => (
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
                          <Button
                            variant="primary"
                            size="micro"
                            onClick={() => handleRenameFolder(folder.id, renameValue)}
                            disabled={folderBusy}
                          >
                            Save
                          </Button>
                          <Button size="micro" onClick={() => setRenamingFolderId(null)}>
                            Cancel
                          </Button>
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
                          <div className="sdl-modal__folder-icon">📁</div>
                          <div className="sdl-modal__folder-name">{folder.name}</div>
                          <div className="sdl-modal__folder-count">
                            {addToFolderMode
                              ? `Add ${selected.size} file${selected.size !== 1 ? "s" : ""} here`
                              : `${folder.assetCount} file${folder.assetCount !== 1 ? "s" : ""}`}
                          </div>
                        </button>
                        {!addToFolderMode && (
                          <div className="sdl-modal__folder-menu">
                            <Button
                              size="micro"
                              onClick={() => {
                                setRenamingFolderId(folder.id);
                                setRenameValue(folder.name);
                              }}
                            >
                              Rename
                            </Button>
                            <Button
                              size="micro"
                              tone="critical"
                              onClick={() => {
                                if (confirm(`Delete folder "${folder.name}"? Files will not be deleted from Shopify.`)) {
                                  handleDeleteFolder(folder.id);
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            {renderFileGrid(
              displayFiles,
              searchedFiles !== null ? "No files match the search." : "No files found.",
            )}

            {!searchedFiles && hasMore ? (
              <div ref={setSentinelRef} className="sdl-modal__load-more">
                {loadMoreFetcher.state !== "idle" ? (
                  <InlineStack align="center" gap="200">
                    <Spinner size="small" accessibilityLabel="Loading more files" />
                    <Text as="span" variant="bodySm" tone="subdued">
                      Loading more files…
                    </Text>
                  </InlineStack>
                ) : null}
              </div>
            ) : null}

            {/* Poster fallback info */}
            {mode === "poster" && !selectedFile && (shopLogoUrl || productFeaturedImageUrl) ? (
              <Banner tone="info" title="Fallback images">
                <BlockStack gap="100">
                  {shopLogoUrl ? (
                    <InlineStack gap="200" blockAlign="center">
                      <img src={shopLogoUrl} alt="Shop logo" width={32} height={32} style={{ objectFit: "cover", borderRadius: 4 }} />
                      <Text as="span" variant="bodySm">Shop logo shown while loading</Text>
                    </InlineStack>
                  ) : null}
                  {productFeaturedImageUrl ? (
                    <InlineStack gap="200" blockAlign="center">
                      <img src={productFeaturedImageUrl} alt="Product" width={32} height={32} style={{ objectFit: "cover", borderRadius: 4 }} />
                      <Text as="span" variant="bodySm">Product image used as fallback</Text>
                    </InlineStack>
                  ) : null}
                </BlockStack>
              </Banner>
            ) : null}
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}
