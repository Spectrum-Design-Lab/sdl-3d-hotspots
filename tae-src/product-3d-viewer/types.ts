/**
 * Local types for the TAE bundle. These don't justify promotion to
 * `@spectrum-design-lab/shared` — they're shapes the storefront viewer
 * happens to see at runtime, not contract-level entities. The admin
 * uses richer Zod-validated types from sdl3d-schemas; the storefront
 * only needs the subset the published metafield JSON carries.
 *
 * The new TAE src/ tree is excluded from the main tsconfig (esbuild
 * compiles, doesn't typecheck), so these annotations are advisory —
 * they keep the source readable without committing to strict-mode
 * compliance for window globals and `<model-viewer>` interop.
 */

export interface Sdl3dViewerSettings {
  cameraControls?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  autoRotateDirection?: "forward" | "reverse";
  cameraOrbit?: string;
  cameraTarget?: string;
  fieldOfView?: string;
  exposure?: number;
  interactionPrompt?: string;
  horizontalLock?: boolean;
  rotationMode?: string;
  lockedPolarAngle?: string | null;
  minCameraOrbit?: string | null;
  maxCameraOrbit?: string | null;
  backgroundColor?: string;
  showFullscreen?: boolean;
}

export interface Sdl3dHotspot {
  id?: string;
  sortOrder?: number;
  visible?: boolean;
  title?: string;
  body?: string;
  icon?: string | null;
  color?: string | null;
  style?: string;
  animation?: string;
  position?: string;
  normal?: string;
  focusTarget?: string;
  focusOrbit?: string;
  mediaImageUrl?: string | null;
  mediaVideoUrl?: string | null;
  ctaLabel?: string;
  ctaUrl?: string;
}

export interface Sdl3dHotspot360Keyframe {
  frame: number;
  x: number;
  y: number;
}

export interface Sdl3dHotspot360 extends Sdl3dHotspot {
  keyframes?: Sdl3dHotspot360Keyframe[];
  visibleFrameStart?: number;
  visibleFrameEnd?: number;
}

export interface Sdl3dImageSequenceFrame {
  imageUrl?: string;
}

export interface SidebarOpts {
  renderMedia?: (h: Sdl3dHotspot) => string;
}

export interface SidebarElement extends HTMLDivElement {
  _selectIndex: (idx: number) => void;
  _clearSelection: () => void;
}

export interface SdlGlobal {
  ce: (tag: string, cls?: string) => HTMLElement;
  jd: <T>(root: Element, selector: string, fallback: T) => T;
  sa: (el: Element, attr: string, on: boolean) => void;
  mkFs: () => HTMLButtonElement;
  sFb: (R: HTMLElement) => void;
  mkSidebar: (
    hotspots: Sdl3dHotspot[],
    onSelect?: (h: Sdl3dHotspot, i: number) => void,
    opts?: SidebarOpts,
  ) => SidebarElement;
  loadMV: () => Promise<unknown>;
  init3d?: (R: HTMLElement) => void;
  i360?: (R: HTMLElement) => void;
  aIM?: (R: HTMLElement, c: any) => void;
  aI3?: (R: HTMLElement, c: any) => void;
  applyS?: (mv: any, R: HTMLElement, s: Sdl3dViewerSettings) => void;
}

declare global {
  interface Window {
    _sdl3d: SdlGlobal;
  }
}

export {};
