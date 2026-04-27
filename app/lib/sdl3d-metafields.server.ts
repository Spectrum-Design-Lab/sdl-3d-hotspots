import { SDL3D_METAFIELD_NAMESPACE } from "@spectrum-design-lab/shared";
import { adminGraphql, type AdminGraphqlClient } from "./sdl3d-graphql.server";

const NAMESPACE = SDL3D_METAFIELD_NAMESPACE;

type DefinitionResult = {
  key: string;
  status: "created" | "exists" | "error";
  message?: string;
};

const viewerSettingsSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    autoRotate: { type: "boolean" },
    cameraControls: { type: "boolean" },
    cameraOrbit: { type: ["string", "null"] },
    cameraTarget: { type: ["string", "null"] },
    fieldOfView: { type: ["string", "null"] },
    minCameraOrbit: { type: ["string", "null"] },
    maxCameraOrbit: { type: ["string", "null"] },
    exposure: { type: "number" },
    environmentImage: { type: ["string", "null"] },
    skyboxImage: { type: ["string", "null"] },
    poster: { type: ["string", "null"] },
    interactionPrompt: { type: ["string", "null"] },
    rotationMode: { type: "string", enum: ["free", "horizontal_only"] },
    horizontalLock: { type: "boolean" },
    lockedPolarAngle: { type: ["string", "null"] },
    hotspotStyle: { type: "string" },
    showFullscreen: { type: "boolean" },
    showArButton: { type: "boolean" },
    backgroundColor: { type: ["string", "null"] },
  },
  required: [
    "autoRotate",
    "cameraControls",
    "exposure",
    "rotationMode",
    "horizontalLock",
    "hotspotStyle",
    "showFullscreen",
    "showArButton",
  ],
};

const hotspotsSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      sortOrder: { type: "integer" },
      visible: { type: "boolean" },
      title: { type: "string" },
      body: { type: "string" },
      icon: { type: ["string", "null"] },
      style: { type: "string" },
      color: { type: ["string", "null"] },
      position: { type: "string" },
      normal: { type: ["string", "null"] },
      focusTarget: { type: ["string", "null"] },
      focusOrbit: { type: ["string", "null"] },
      ctaLabel: { type: ["string", "null"] },
      ctaUrl: { type: ["string", "null"] },
    },
    required: ["id", "sortOrder", "visible", "title", "body", "style", "position"],
  },
};

const definitions = [
  {
    name: "3D Viewer Schema Version",
    namespace: NAMESPACE,
    key: "schema_version",
    description:
      "Integer schema version of the sdl_3d.* payload. Storefront viewer refuses unknown versions.",
    type: "number_integer",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
  },
  {
    name: "3D Viewer Enabled",
    namespace: NAMESPACE,
    key: "enabled",
    description: "Enables the 3D hotspot viewer for this product.",
    type: "boolean",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
  },
  {
    name: "3D Viewer Source Mode",
    namespace: NAMESPACE,
    key: "mode",
    description: "Controls whether the storefront uses app data or product metafields.",
    type: "single_line_text_field",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
  },
  {
    name: "Viewer Type",
    namespace: NAMESPACE,
    key: "viewer_type",
    description: "Viewer mode: model_3d or image_360.",
    type: "single_line_text_field",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
  },
  {
    name: "360 Image Sequence",
    namespace: NAMESPACE,
    key: "image_sequence",
    description: "JSON array of image URLs for the 360° image sequence viewer.",
    type: "json",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
  },
  {
    name: "360 Hotspots",
    namespace: NAMESPACE,
    key: "hotspots_360",
    description: "JSON array of keyframe-based hotspots for the 360° viewer.",
    type: "json",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
  },
  {
    name: "3D Model File",
    namespace: NAMESPACE,
    key: "model_file",
    description: "Primary GLB model file used by the 3D viewer.",
    type: "file_reference",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
    validations: [{ name: "file_type_options", value: JSON.stringify(["Model3d"]) }],
  },
  {
    name: "3D Viewer Poster File",
    namespace: NAMESPACE,
    key: "poster_file",
    description: "Poster image shown before the 3D model loads.",
    type: "file_reference",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
    validations: [{ name: "file_type_options", value: JSON.stringify(["Image"]) }],
  },
  {
    name: "3D Viewer Settings",
    namespace: NAMESPACE,
    key: "viewer_settings",
    description: "JSON settings for camera, lighting, interaction, and display behavior.",
    type: "json",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
  },
  {
    name: "3D Viewer Hotspots",
    namespace: NAMESPACE,
    key: "hotspots",
    description: "JSON array of hotspots used by the storefront 3D viewer.",
    type: "json",
    ownerType: "PRODUCT",
    access: { storefront: "PUBLIC_READ" },
  },
];

export async function getSdl3dDefinitions(admin: AdminGraphqlClient) {
  const data = await adminGraphql<{
    metafieldDefinitions: {
      nodes: Array<{
        id: string;
        namespace: string;
        key: string;
        name: string;
      }>;
    };
  }>(
    admin,
    `
      query GetMetafieldDefinitions {
        metafieldDefinitions(ownerType: PRODUCT, first: 100) {
          nodes {
            id
            namespace
            key
            name
          }
        }
      }
    `,
  );

  return data.metafieldDefinitions.nodes.filter((node) => node.namespace === NAMESPACE);
}

export async function ensureSdl3dMetafieldDefinitions(admin: AdminGraphqlClient) {
  const existing = await getSdl3dDefinitions(admin);
  const existingKeys = new Set(existing.map((d) => d.key));
  const results: DefinitionResult[] = [];

  for (const definition of definitions) {
    if (existingKeys.has(definition.key)) {
      results.push({ key: definition.key, status: "exists" });
      continue;
    }

    try {
      const data = await adminGraphql<{
        metafieldDefinitionCreate: {
          createdDefinition: { id: string; key: string } | null;
          userErrors: Array<{ field: string[] | null; message: string }>;
        };
      }>(
        admin,
        `
          mutation CreateDefinition($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition {
                id
                key
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        { definition },
      );

      const errors = data.metafieldDefinitionCreate.userErrors;
      if (errors.length) {
        results.push({
          key: definition.key,
          status: "error",
          message: errors.map((e) => e.message).join("; "),
        });
      } else {
        results.push({ key: definition.key, status: "created" });
      }
    } catch (error) {
      results.push({
        key: definition.key,
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // Throttle between definition creates to avoid rate limits
    await new Promise((r) => setTimeout(r, 150));
  }

  return results;
}