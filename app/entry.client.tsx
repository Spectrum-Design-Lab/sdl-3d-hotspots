/**
 * Client entry — initialises Sentry before React Router hydrates, then
 * delegates to RR7's default `HydratedRouter` flow. This file is opt-in
 * (RR7 supplies a default entry when none is provided); creating it
 * here lets us run code before any route component renders, which is
 * the only place early hydration errors can be caught.
 */
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { initSentryClient } from "./lib/sentry.client";

initSentryClient();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
