/**
 * Editor's Setup wizard sidebar — Polaris migration (Slice 5C PR #5b).
 *
 * Renders the 5-step "Setup" navigator (Product / Media / Viewer / Hotspots
 * / Publish) inside the editor's left column. Clicking a step focuses the
 * relevant inspector tab in the parent route.
 *
 * UX upgrades:
 * - ProgressBar quantifies how close a product is to publish-ready (N of 5
 *   steps in "done" status). Merchants can scan completion at a glance.
 * - ActionList replaces the bespoke step buttons, giving keyboard nav,
 *   focus rings, and active-item styling for free.
 * - Polaris Icons replace the glyph strings (✓ / ○ / !) — CheckIcon,
 *   CircleIcon, AlertCircleIcon mapped from StepStatus.
 * - Validation blockers move from a muted in-card list to a Polaris Banner
 *   with tone="critical", which is the canonical pattern for blocking
 *   errors in Shopify admin.
 * - Empty state (no product selected) is now a proper Polaris EmptyState.
 */
import { useMemo } from "react";
import {
  ActionList,
  BlockStack,
  Banner,
  Card,
  EmptyState,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";
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

export type StepId = "product" | "media" | "viewer" | "hotspots" | "publish";
export type StepStatus = "done" | "todo" | "warn";

export interface Step {
  id: StepId;
  label: string;
  status: StepStatus;
}

interface Sdl3dEditorSidebarProps {
  loaderData: SidebarLoaderData;
  validation: SidebarValidation;
  readyTone: Tone;
  steps: Step[];
  currentStep: StepId | null;
  onStepClick: (id: StepId) => void;
}

function iconForStatus(status: StepStatus) {
  switch (status) {
    case "done":
      return CheckCircleIcon;
    case "warn":
      return AlertCircleIcon;
    case "todo":
    default:
      return null;
  }
}

export function Sdl3dEditorSidebar({
  loaderData,
  validation,
  steps,
  currentStep,
  onStepClick,
}: Sdl3dEditorSidebarProps) {
  // Completion percentage drives the ProgressBar. We count steps in "done"
  // status only — "warn" and "todo" both register as incomplete.
  const completionPct = useMemo(() => {
    if (steps.length === 0) return 0;
    const done = steps.filter((s) => s.status === "done").length;
    return Math.round((done / steps.length) * 100);
  }, [steps]);

  const doneCount = steps.filter((s) => s.status === "done").length;

  if (!loaderData.selectedProduct) {
    return (
      <Card>
        <EmptyState
          heading="Pick a product to start"
          image=""
          action={undefined}
        >
          <Text as="p">
            Use the "Browse product" button in the top bar to choose which product to attach a 3D viewer to.
          </Text>
        </EmptyState>
      </Card>
    );
  }

  return (
    <BlockStack gap="300">
      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingSm">
              Setup
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {doneCount} of {steps.length} steps complete
            </Text>
            <ProgressBar progress={completionPct} size="small" />
          </BlockStack>

          <ActionList
            items={steps.map((step) => ({
              content: step.label,
              prefix: (
                <div
                  style={{
                    width: 16,
                    height: 16,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color:
                      step.status === "done"
                        ? "var(--p-color-icon-success)"
                        : step.status === "warn"
                          ? "var(--p-color-icon-warning)"
                          : "var(--p-color-icon-subdued)",
                  }}
                >
                  <PolarisStepIcon status={step.status} />
                </div>
              ),
              active: currentStep === step.id,
              onAction: () => onStepClick(step.id),
            }))}
          />
        </BlockStack>
      </Card>

      {validation.errors.length > 0 ? (
        <Banner tone="critical" title="Resolve before publish">
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {validation.errors.map((error) => (
              <li key={error}>
                <Text as="span" variant="bodySm">
                  {error}
                </Text>
              </li>
            ))}
          </ul>
        </Banner>
      ) : null}
    </BlockStack>
  );
}

function PolarisStepIcon({ status }: { status: StepStatus }) {
  const Icon = iconForStatus(status);
  if (Icon) {
    return <Icon style={{ width: 16, height: 16 }} />;
  }
  // "todo" — render an empty circle outline since Polaris ships no plain
  // CircleIcon variant. CSS-only so it inherits the surrounding color token.
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        border: "1.5px solid currentColor",
      }}
    />
  );
}
