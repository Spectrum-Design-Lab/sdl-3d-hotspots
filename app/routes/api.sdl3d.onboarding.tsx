/**
 * API route for onboarding operations:
 *   completeOnboarding, skipOnboarding, resetOnboarding
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { withAdminAuth } from "../lib/admin-auth.server";
import prisma from "../db.server";

export function loader({ request }: LoaderFunctionArgs) {
  return new Response("Method not allowed", { status: 405 });
}

/* ───── helpers ───── */

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* ───── action ───── */

export async function action({ request }: ActionFunctionArgs) {
  return withAdminAuth(request, async ({ session }) => {
    const shopDomain = session.shop;
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "");

    if (intent === "completeOnboarding" || intent === "skipOnboarding") {
      await prisma.shop.upsert({
        where: { shopDomain },
        update: { onboardingComplete: true },
        create: { shopDomain, onboardingComplete: true },
      });
      return json({ ok: true });
    }

    if (intent === "resetOnboarding") {
      await prisma.shop.update({
        where: { shopDomain },
        data: { onboardingComplete: false },
      });
      return json({ ok: true, resetOnboarding: true });
    }

    return json({ ok: false, message: "Unknown onboarding intent." }, 400);
  });
}
