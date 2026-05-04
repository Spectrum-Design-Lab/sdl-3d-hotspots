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

const STATUS_GLYPH: Record<StepStatus, string> = {
  done: "✓",
  todo: "○",
  warn: "!",
};

export function Sdl3dEditorSidebar({
  loaderData,
  validation,
  steps,
  currentStep,
  onStepClick,
}: Sdl3dEditorSidebarProps) {
  if (!loaderData.selectedProduct) {
    return (
      <div className="sdl-card">
        <div className="sdl-empty-state">
          Pick a product from the top bar to start configuring its viewer.
        </div>
      </div>
    );
  }

  return (
    <section className="sdl-card sdl-steps-card">
      <div className="sdl-card__header">
        <div>
          <div className="sdl-card__title">Setup</div>
        </div>
      </div>
      <ol className="sdl-steps">
        {steps.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              className={`sdl-step sdl-step--${step.status} ${
                currentStep === step.id ? "sdl-step--active" : ""
              }`}
              onClick={() => onStepClick(step.id)}
            >
              <span className={`sdl-step__marker sdl-step__marker--${step.status}`}>
                {STATUS_GLYPH[step.status]}
              </span>
              <span className="sdl-step__label">{step.label}</span>
            </button>
          </li>
        ))}
      </ol>
      {validation.errors.length > 0 ? (
        <div className="sdl-mt-3">
          <div className="sdl-text-muted" style={{ fontWeight: 700, marginBottom: 6, fontSize: 12 }}>
            Blockers
          </div>
          <ul className="sdl-validation-list">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
