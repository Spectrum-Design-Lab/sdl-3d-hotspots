/**
 * Product picker modal — Polaris migration (Slice 5C PR #5e).
 *
 * Replaces the bespoke sdl-modal overlay + grid/list toggle with a Polaris
 * `Modal` containing a search-driven `ResourceList`. The Modal owns
 * escape/focus/animation; the ResourceList handles single-select via row
 * clicks that confirm-then-navigate to the editor's product context.
 *
 * Grid/list view toggle from the prior bespoke modal is intentionally
 * dropped — Polaris ResourceList is a single canonical layout, matching
 * the rest of Shopify admin, and the dual-view toggle wasn't carrying
 * its weight UX-wise (most merchants only pick a product once per
 * session).
 *
 * Search submits a same-route navigation that re-runs the editor loader
 * with `?q=…` — identical behaviour to the prior modal, just with a
 * Polaris TextField + Button instead of a bespoke search input.
 */
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  EmptyState,
  InlineStack,
  Modal,
  ResourceList,
  ResourceItem,
  Text,
  TextField,
} from "@shopify/polaris";

interface Product {
  id: string;
  title: string;
  handle: string | null;
  status: string | null;
}

interface ProductBrowserModalProps {
  open: boolean;
  onClose: () => void;
  q: string;
  productGid: string;
  products: Product[];
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
  const [searchQuery, setSearchQuery] = useState(q);

  const handleSearch = useCallback(() => {
    if (!confirmDiscardChanges()) return;
    const params = new URLSearchParams({ q: searchQuery });
    if (productGid) params.set("product", productGid);
    navigate(`/app/sdl3d/editor?${params.toString()}`);
  }, [searchQuery, productGid, navigate, confirmDiscardChanges]);

  const handleSelectProduct = useCallback(
    (productId: string) => {
      if (!confirmDiscardChanges()) return;
      const params = new URLSearchParams({ product: productId });
      if (q) params.set("q", q);
      navigate(`/app/sdl3d/editor?${params.toString()}`);
      onClose();
    },
    [q, navigate, confirmDiscardChanges, onClose],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Find a product"
      size="large"
      secondaryActions={[{ content: "Close", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineStack gap="200" blockAlign="end">
            <Box width="100%">
              <TextField
                label="Search"
                labelHidden
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search products by title, handle, or tag"
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setSearchQuery("")}
              />
            </Box>
            <Button variant="primary" onClick={handleSearch}>
              Search
            </Button>
          </InlineStack>

          {products.length === 0 ? (
            <EmptyState
              heading={q ? `No products match "${q}"` : "No products found"}
              image=""
            >
              <Text as="p">Try a different search or clear the query to see active products.</Text>
            </EmptyState>
          ) : (
            <ResourceList
              items={products}
              resourceName={{ singular: "product", plural: "products" }}
              renderItem={(p) => {
                const active = p.id === productGid;
                return (
                  <ResourceItem
                    id={p.id}
                    onClick={() => handleSelectProduct(p.id)}
                    accessibilityLabel={`Open ${p.title}`}
                  >
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center" wrap={false}>
                        <Text as="h3" variant="bodyMd" fontWeight={active ? "bold" : "semibold"}>
                          {p.title}
                        </Text>
                        {active ? <Badge tone="info">Current</Badge> : null}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {p.handle || "no handle"} · {p.status?.toLowerCase() || "unknown"}
                      </Text>
                    </BlockStack>
                  </ResourceItem>
                );
              }}
            />
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
