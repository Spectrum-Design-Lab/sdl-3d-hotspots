import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

interface ProductBrowserModalProps {
  open: boolean;
  onClose: () => void;
  q: string;
  productGid: string;
  products: Array<{
    id: string;
    title: string;
    handle: string | null;
    status: string | null;
  }>;
  confirmDiscardChanges: () => boolean;
}

export function ProductBrowserModal({
  open,
  onClose,
  q,
  productGid,
  products,
  confirmDiscardChanges,
}: ProductBrowserModalProps) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Esc key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleProductClick = useCallback(
    (e: React.MouseEvent) => {
      if (!confirmDiscardChanges()) {
        e.preventDefault();
      } else {
        onClose();
      }
    },
    [confirmDiscardChanges, onClose],
  );

  if (!open) return null;

  return (
    <div className="sdl-modal-overlay" onClick={onClose}>
      <div className="sdl-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sdl-modal__header">
          <div className="sdl-modal__title">Find a Product</div>
          <div className="sdl-modal__header-actions">
            <div className="sdl-modal__view-toggle">
              <button
                type="button"
                className={`sdl-modal__view-btn ${viewMode === "grid" ? "sdl-modal__view-btn--active" : ""}`}
                onClick={() => setViewMode("grid")}
                title="Grid view"
              >
                &#8862;
              </button>
              <button
                type="button"
                className={`sdl-modal__view-btn ${viewMode === "list" ? "sdl-modal__view-btn--active" : ""}`}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                &#8801;
              </button>
            </div>
            <button type="button" className="sdl-modal__close" onClick={onClose}>
              &#10005;
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="sdl-modal__toolbar">
          <form
            className="sdl-modal__search"
            style={{ flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!confirmDiscardChanges()) return;
              const formData = new FormData(e.currentTarget);
              const searchQ = (formData.get("q") as string) || "";
              const params = new URLSearchParams({ q: searchQ });
              if (productGid) params.set("product", productGid);
              navigate(`/app/sdl3d/editor?${params.toString()}`);
            }}
          >
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="&#128269; Search"
              className="sdl-input"
            />
            <button type="submit" className="sdl-btn sdl-btn--primary sdl-btn--sm">
              Search
            </button>
          </form>
        </div>

        {/* Product results */}
        <div className={`sdl-modal__body sdl-modal__body--${viewMode}`}>
          {products.length > 0 ? (
            products.map((p) => {
              const active = p.id === productGid;
              return (
                <Link
                  key={p.id}
                  to={`/app/sdl3d/editor?q=${encodeURIComponent(q)}&product=${encodeURIComponent(p.id)}`}
                  onClick={handleProductClick}
                  className={`sdl-modal__file ${active ? "sdl-modal__file--selected" : ""}`}
                  style={{ textDecoration: "none" }}
                >
                  <div className="sdl-modal__file-thumb">
                    <div className="sdl-modal__file-icon">{"\u{1F4E6}"}</div>
                  </div>
                  <div className="sdl-modal__file-name" title={p.title}>{p.title}</div>
                  <div className="sdl-modal__file-status">
                    {p.handle || "no handle"} &middot; {p.status || "unknown"}
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="sdl-modal__empty">
              {q ? `No products found for \u201c${q}\u201d` : "No products found."}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sdl-modal__footer">
          <div className="sdl-modal__footer-info">
            {products.length > 0 && (
              <span className="sdl-text-muted">{products.length} result{products.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <div className="sdl-modal__footer-actions">
            <button type="button" className="sdl-btn sdl-btn--sm" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
