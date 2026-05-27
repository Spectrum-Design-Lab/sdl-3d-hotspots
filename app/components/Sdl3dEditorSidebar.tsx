/**
 * Editor's Setup wizard sidebar — Polaris migration (Slice 5C PR #5b).
 * Slice 7 PR #4: absorbs the bottom-strip "Ready to publish" banner — the
 * Publish step now owns its own itemized issue list with deep-link actions
 * into the inspector tab that owns each field.
 */
import { useMemo } from "react";
import {
  ActionList,
  BlockStack,
  Banner,
  Button,
  Card,
  EmptyState,
  InlineStack,
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

export type StepId = "product" | "media" | "viewer" | "hotspots" | "publish";
export type StepStatus = "done" | "todo" | "warn";

export interface Step {
  id: StepId;
  label: string;
  status: StepStatus;
}

export interface ValidationIssue {
  id: string;
  kind: "error" | "warning";
  message: string;
  jumpLabel: string | null;
  onJump: (() => void) | null;
}

interface Sdl3dEditorSidebarProps {
  loaderData: SidebarLoaderData;
  readyTone: Tone;
  steps: Step[];
  currentStep: StepId | null;
  onStepClick: (id: StepId) => void;
  validationIssues: ValidationIssue[];
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
  steps,
  currentStep,
  onStepClick,
  validationIssues,
}: Sdl3dEditorSidebarProps) {
  const errorIssues = validationIssues.filter((i) => i.kind === "error");
  const warningIssues = validationIssues.filter((i) => i.kind === "warning");
  const hasErrors = errorIssues.length > 0;
  const hasWarnings = warningIssues.length > 0;
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
            Use the &quot;Browse product&quot; button in the top bar to choose which product to attach a 3D viewer to.
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

      {/* PR #4: itemized publish blockers, scoped to the Publish step. Each
          issue carries a deep-link button into the inspector tab that owns
          the field. Replaces the middle-column bottom banner so merchants
          read "what's left" in one place (here). */}
      {hasErrors || hasWarnings ? (
        <Banner
          tone={hasErrors ? "critical" : "warning"}
          title={
            hasErrors
              ? `Resolve ${errorIssues.length} issue${errorIssues.length === 1 ? "" : "s"} before publishing${hasWarnings ? ` (and ${warningIssues.length} warning${warningIssues.length === 1 ? "" : "s"})` : ""}`
              : `${warningIssues.length} warning${warningIssues.length === 1 ? "" : "s"}`
          }
        >
          <BlockStack gap="100">
            {[...errorIssues, ...warningIssues].map((issue) => (
              <InlineStack
                key={issue.id}
                gap="200"
                align="space-between"
                blockAlign="center"
                wrap={false}
              >
                <Text
                  as="span"
                  variant="bodySm"
                  tone={issue.kind === "warning" ? "subdued" : undefined}
                >
                  {issue.message}
                </Text>
                {issue.jumpLabel && issue.onJump ? (
                  <Button variant="plain" size="micro" onClick={issue.onJump}>
                    Jump to {issue.jumpLabel}
                  </Button>
                ) : null}
              </InlineStack>
            ))}
          </BlockStack>
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
