import { Link, useLoaderData, useFetcher, useRouteError, isRouteErrorResponse } from "react-router";
import { useState, useEffect, useMemo } from "react";
import prisma from "../db.server";
import shopify from "../shopify.server";
import { ensureShop } from "../lib/sdl3d-graphql.server";
import "../styles/editor.css";

// Action removed — mutations go through /api/sdl3d/presets

export async function loader({ request }: { request: Request }) {
  const { session } = await shopify.authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  const presets = await prisma.preset.findMany({
    where: { shopId: shop.id },
    orderBy: { updatedAt: "desc" },
  });

  return { presets, shop: session.shop, darkMode: shop.darkMode ?? false };
}

function parseHotspotCount(json: string): number {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function parseHotspotColors(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 8).map((h: { color?: string | null }) => h.color || "#3b82f6");
  } catch {
    return [];
  }
}

export default function PresetsRoute() {
  const { presets, darkMode } = useLoaderData<typeof loader>();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [flash, setFlash] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const deleteFetcher = useFetcher<{ ok?: boolean; message?: string }>();
  const renameFetcher = useFetcher<{ ok?: boolean; message?: string }>();

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data?.message) {
      setFlash(deleteFetcher.data.message);
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  useEffect(() => {
    if (renameFetcher.state === "idle" && renameFetcher.data?.ok) {
      setFlash(renameFetcher.data.message || "Preset renamed.");
      setRenamingId(null);
    }
  }, [renameFetcher.state, renameFetcher.data]);

  // Parse hotspot data for display
  const presetData = useMemo(() => {
    return presets.map((preset) => {
      const count3d = parseHotspotCount(preset.hotspotsJson);
      const count360 = preset.hotspotsJson360 ? parseHotspotCount(preset.hotspotsJson360) : 0;
      const colors = parseHotspotColors(preset.hotspotsJson);
      return { ...preset, count3d, count360, totalCount: count3d + count360, colors };
    });
  }, [presets]);

  return (
    <div className="sdl-editor" data-theme={darkMode ? "dark" : "light"}>
      <div className="sdl-editor__inner" style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
        {flash && (
          <div className="sdl-toast sdl-toast--success" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{flash}</div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Hotspot Presets</h1>
            <p className="sdl-text-muted" style={{ margin: "4px 0 0" }}>
              Saved hotspot collections. Select hotspots in the editor to save them as presets, then apply them to any product.
            </p>
          </div>
          <Link to="/app/sdl3d/editor" className="sdl-btn sdl-btn--sm">
            Back to Editor
          </Link>
        </div>

        {presetData.length === 0 ? (
          <div className="sdl-card">
            <div className="sdl-card__header">
              <div>
                <div className="sdl-card__title">No presets yet</div>
                <div className="sdl-card__subtitle">
                  To create a preset, select hotspots in the editor using checkboxes, then click "Save as Preset".
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {presetData.map((preset) => (
              <div key={preset.id} className="sdl-card">
                <div className="sdl-card__header">
                  <div style={{ flex: 1 }}>
                    {renamingId === preset.id ? (
                      <renameFetcher.Form method="post" action="/api/sdl3d/presets" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="hidden" name="intent" value="rename" />
                        <input type="hidden" name="presetId" value={preset.id} />
                        <input
                          className="sdl-input"
                          name="newName"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          style={{ flex: 1 }}
                          autoFocus
                        />
                        <button type="submit" className="sdl-btn sdl-btn--primary sdl-btn--sm" disabled={renameFetcher.state !== "idle"}>
                          {renameFetcher.state !== "idle" ? "Saving\u2026" : "Save"}
                        </button>
                        <button type="button" className="sdl-btn sdl-btn--sm" onClick={() => setRenamingId(null)}>Cancel</button>
                      </renameFetcher.Form>
                    ) : (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="sdl-card__title">{preset.name}</div>
                          {/* Color dot preview */}
                          {preset.colors.length > 0 && (
                            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                              {preset.colors.map((c, i) => (
                                <span
                                  key={i}
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: c,
                                    border: "1px solid rgba(0,0,0,0.15)",
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="sdl-card__subtitle">
                          {preset.totalCount} hotspot{preset.totalCount === 1 ? "" : "s"}
                          {preset.count360 > 0
                            ? ` (${preset.count3d} 3D, ${preset.count360} 360\u00b0)`
                            : ""}
                          {" \u00b7 "}
                          Updated {new Date(preset.updatedAt).toLocaleDateString()}
                        </div>
                      </>
                    )}
                  </div>
                  {renamingId !== preset.id && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="sdl-btn sdl-btn--sm"
                        onClick={() => setExpandedId(expandedId === preset.id ? null : preset.id)}
                      >
                        {expandedId === preset.id ? "Hide" : "View"}
                      </button>
                      <button
                        type="button"
                        className="sdl-btn sdl-btn--sm"
                        onClick={() => {
                          setRenamingId(preset.id);
                          setRenameValue(preset.name);
                        }}
                      >
                        Rename
                      </button>
                      <deleteFetcher.Form method="post" action="/api/sdl3d/presets" style={{ display: "inline" }}>
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="presetId" value={preset.id} />
                        <button
                          type="submit"
                          className="sdl-btn sdl-btn--danger sdl-btn--sm"
                          disabled={deleteFetcher.state !== "idle"}
                          onClick={(e) => {
                            if (!confirm(`Delete preset "${preset.name}"?`)) {
                              e.preventDefault();
                            }
                          }}
                        >
                          Delete
                        </button>
                      </deleteFetcher.Form>
                    </div>
                  )}
                </div>
                {/* Expanded hotspot list */}
                {expandedId === preset.id && (
                  <PresetHotspotList hotspotsJson={preset.hotspotsJson} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PresetHotspotList({ hotspotsJson }: { hotspotsJson: string }) {
  let hotspots: Array<{
    title?: string;
    body?: string;
    style?: string;
    color?: string | null;
    visible?: boolean;
  }> = [];
  try {
    const parsed = JSON.parse(hotspotsJson);
    if (Array.isArray(parsed)) hotspots = parsed;
  } catch { /* ignore */ }

  if (hotspots.length === 0) {
    return (
      <div style={{ padding: "8px 16px 16px" }}>
        <div className="sdl-text-muted" style={{ fontSize: 13 }}>No hotspots in this preset.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 16px", display: "grid", gap: 6 }}>
      {hotspots.map((h, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 6,
            background: "var(--panel-alt, #f8fafc)",
            border: "1px solid var(--border, #dbe4ee)",
            fontSize: 13,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: h.color || "#3b82f6",
              border: "1px solid rgba(0,0,0,0.15)",
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {h.title || `Hotspot ${i + 1}`}
          </span>
          <span className="sdl-text-muted" style={{ fontSize: 11, flexShrink: 0 }}>
            {h.style || "card"}
          </span>
          {h.visible === false && (
            <span className="sdl-text-muted" style={{ fontSize: 11, flexShrink: 0 }}>hidden</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} \u2014 ${error.statusText || "Something went wrong"}`
    : error instanceof Error ? error.message : "An unexpected error occurred.";

  return (
    <div className="sdl-editor" data-theme="light">
      <div style={{ maxWidth: 600, margin: "60px auto", padding: 24, textAlign: "center" }}>
        <h2>Presets error</h2>
        <p>{message}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <a href="/app/sdl3d/presets" className="sdl-btn sdl-btn--primary">Reload</a>
          <a href="/app" className="sdl-btn">Dashboard</a>
        </div>
      </div>
    </div>
  );
}
