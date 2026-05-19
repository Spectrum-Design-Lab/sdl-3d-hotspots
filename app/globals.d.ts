declare global {
  namespace JSX {
    interface IntrinsicElements {
      // <model-viewer> is the canonical 3D-viewer web component used in the
      // editor preview and the storefront viewer.
      "model-viewer": any;

      // AppBridge-rendered web components, kept ONLY for the non-embedded
      // OAuth login route at `app/routes/auth.login/route.tsx`. Embedded
      // admin pages render via Polaris + `<NavMenu>` (PR #5d) and don't
      // need any of these. If the login page also migrates to Polaris in
      // a future slice, the whole namespace below can be deleted.
      "s-button": any;
      "s-page": any;
      "s-section": any;
      "s-text-field": any;
    }
  }
}

export {};