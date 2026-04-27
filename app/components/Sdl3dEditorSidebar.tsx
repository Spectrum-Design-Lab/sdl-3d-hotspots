import { useState } from "react";
import type { Tone } from "./Sdl3dEditorUI";

export interface SidebarLoaderData {
  shop: string;
  q: string;
  productGid: string;
  products: Array<{
    id: string;
    title: string;
    handle: string | null;
    status: string | null;
  }>;
  selectedProduct: {
    id: string;
    title: string;
    handle: string | null;
    status: string | null;
  } | null;
  config: {
    id: string;
    enabled: boolean;
    sourceMode: string;
    modelFileShopifyGid: string;
    posterFileShopifyGid: string;
  };
}

export interface SidebarValidation {
  isPublishReady: boolean;
  errors: string[];
  warnings: string[];
}

export interface CopyableProduct {
  gid: string;
  title: string;
  viewerType: string;
  status: string;
}

interface Sdl3dEditorSidebarProps {
  loaderData: SidebarLoaderData;
  validation: SidebarValidation;
  readyTone: Tone;
  enabled: boolean;
  viewerType: string;
  hotspotsJson: string;
  hotspotsJson360: string;
  viewerSettingsJson: string;
  copyableProducts: CopyableProduct[];
  onEnabledChange: (enabled: boolean) => void;
  onCopyConfig: (sourceGid: string) => void;
  confirmDiscardChanges: () => boolean;
  onOpenProductBrowser: () => void;
}

export function Sdl3dEditorSidebar({
  loaderData,
  validation,
  readyTone,
  enabled,
  viewerType,
  hotspotsJson,
  hotspotsJson360,
  viewerSettingsJson,
  copyableProducts,
  onEnabledChange,
  onCopyConfig,
  confirmDiscardChanges,
  onOpenProductBrowser,
}: Sdl3dEditorSidebarProps) {
  const [copySourceGid, setCopySourceGid] = useState("");

  return (
    <>
      <div className="sdl-card">
        <div className="sdl-card__header">
          <div>
            <div className="sdl-card__title">Product</div>
            <div className="sdl-card__subtitle">Select the product to configure.</div>
          </div>
        </div>
        <button
          type="button"
          className="sdl-file-trigger"
          onClick={onOpenProductBrowser}
        >
          <div className="sdl-file-trigger__thumb">
            <span style={{ fontSize: 18, opacity: 0.4 }}>&#128722;</span>
          </div>
          <div className="sdl-file-trigger__label">
            {loaderData.selectedProduct ? (
              <>
                <div className="sdl-file-trigger__name">{loaderData.selectedProduct.title}</div>
                <div className="sdl-file-trigger__meta">{loaderData.selectedProduct.handle || "no handle"} &middot; {loaderData.selectedProduct.status || "unknown"}</div>
              </>
            ) : (
              <>
                <div className="sdl-file-trigger__name">No product selected</div>
                <div className="sdl-file-trigger__meta">Click to search and select a product</div>
              </>
            )}
          </div>
          <div className="sdl-file-trigger__action">Browse</div>
        </button>
      </div>

      {loaderData.selectedProduct ? (
        <>
          <section className="sdl-card">
            <div className="sdl-card__header">
              <div>
                <div className="sdl-card__title">Ready to publish</div>
                <div className="sdl-card__subtitle">Blocking errors must be fixed before publishing.</div>
              </div>
              <span className={`sdl-badge sdl-badge--${readyTone}`}>
                {validation.isPublishReady ? "ready" : "blocked"}
              </span>
            </div>
            {validation.errors.length > 0 ? (
              <ul className="sdl-validation-list">
                {validation.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : (
              <div className="sdl-text-success">
                No blocking errors.
              </div>
            )}

            {validation.warnings.length > 0 ? (
              <div className="sdl-mt-3">
                <div className="sdl-text-muted" style={{ fontWeight: 700, marginBottom: 6 }}>
                  Warnings
                </div>
                <ul className="sdl-validation-list sdl-validation-list--warning">
                  {validation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="sdl-card">
            <div className="sdl-card__header">
              <div>
                <div className="sdl-card__title">Config</div>
                <div className="sdl-card__subtitle">Viewer toggle.</div>
              </div>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <div className="sdl-subtle-card">
                <label className="sdl-label--inline">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => onEnabledChange(e.target.checked)}
                  />
                  Enabled
                </label>
                <div className="sdl-text-muted" style={{ marginTop: 8, fontSize: 12 }}>
                  Turn the storefront viewer on or off for this product.
                </div>
              </div>

            </div>
          </section>

          {copyableProducts.length > 0 && (
            <section className="sdl-card">
              <div className="sdl-card__header">
                <div>
                  <div className="sdl-card__title">Copy from product</div>
                  <div className="sdl-card__subtitle">Clone settings and hotspots from another configured product.</div>
                </div>
              </div>
              <select
                className="sdl-input sdl-mb-3"
                value={copySourceGid}
                onChange={(e) => setCopySourceGid(e.target.value)}
              >
                <option value="">Select a source product…</option>
                {copyableProducts.map((p) => (
                  <option key={p.gid} value={p.gid}>
                    {p.title} ({p.viewerType === "IMAGE_360" ? "360°" : "3D"} · {p.status})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="sdl-btn sdl-btn--secondary sdl-btn--full"
                disabled={!copySourceGid}
                onClick={() => {
                  if (!copySourceGid) return;
                  if (!confirm("This will overwrite the current product's configuration with the source product's settings and hotspots. Continue?")) return;
                  onCopyConfig(copySourceGid);
                }}
              >
                Copy configuration
              </button>
            </section>
          )}
        </>
      ) : null}
    </>
  );
}
