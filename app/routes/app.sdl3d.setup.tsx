import { Form, useActionData, useLoaderData } from "react-router";
import shopify from "../shopify.server";
import { ensureSdl3dMetafieldDefinitions, getSdl3dDefinitions } from "../lib/sdl3d-metafields.server";

export async function loader({ request }: { request: Request }) {
  const { admin, session } = await shopify.authenticate.admin(request);
  const definitions = await getSdl3dDefinitions(admin);

  return {
    shop: session.shop,
    definitions: definitions.map((d) => ({
      id: d.id,
      namespace: d.namespace,
      key: d.key,
      name: d.name,
    })),
  };
}

export async function action({ request }: { request: Request }) {
  const { admin } = await shopify.authenticate.admin(request);
  const results = await ensureSdl3dMetafieldDefinitions(admin);
  return { results };
}

export default function Sdl3dSetupRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1>Metafield setup</h1>
      <p>Shop: {loaderData.shop}</p>

      <Form method="post">
        <button
          type="submit"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #222",
            cursor: "pointer",
          }}
        >
          Create / verify metafield definitions
        </button>
      </Form>

      {actionData?.results?.length ? (
        <div style={{ marginTop: 24 }}>
          <h2>Last run</h2>
          <ul>
            {actionData.results.map((r: { key: string; status: string; message?: string }) => (
              <li key={r.key}>
                <strong>{r.key}</strong>: {r.status}
                {r.message ? ` — ${r.message}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <h2>Current definitions</h2>
        <ul>
          {loaderData.definitions.map((d) => (
            <li key={d.id}>
              <strong>{d.namespace}.{d.key}</strong> — {d.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}