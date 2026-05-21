import { adminGraphql, type AdminGraphqlClient } from "./sdl3d-graphql.server";

/** Extract filename from a Shopify CDN URL, stripping query params. */
function filenameFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/");
    return segments[segments.length - 1] || "";
  } catch {
    // Fallback: grab text after last slash, before any '?'
    const afterSlash = url.split("/").pop() || "";
    return afterSlash.split("?")[0] || "";
  }
}

export type ShopifyFileSummary = {
  id: string;
  typeName: "Model3d" | "MediaImage";
  name: string;
  alt: string | null;
  fileStatus: string;
  previewUrl: string | null;
};

function normalizeUploadMimeType(file: File, kind: "MODEL_3D" | "IMAGE") {
  const name = file.name.toLowerCase();

  if (kind === "MODEL_3D") {
    if (name.endsWith(".glb")) return "model/gltf-binary";
    if (name.endsWith(".gltf")) return "model/gltf+json";
    return "model/gltf-binary";
  }

  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";

  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }

  return "image/png";
}

export type FileListResult = {
  files: ShopifyFileSummary[];
  hasNextPage: boolean;
  endCursor: string | null;
};

type FileNode =
  | {
      __typename: "Model3d";
      id: string;
      alt: string | null;
      fileStatus: string;
      filename: string;
      preview: { image: { url: string } | null } | null;
    }
  | {
      __typename: "MediaImage";
      id: string;
      alt: string | null;
      fileStatus: string;
      image: { url: string } | null;
    };

function normalizeFileNode(node: FileNode): ShopifyFileSummary {
  if (node.__typename === "Model3d") {
    return {
      id: node.id,
      typeName: "Model3d",
      name: node.filename,
      alt: node.alt,
      fileStatus: node.fileStatus,
      previewUrl: node.preview?.image?.url ?? null,
    };
  }
  return {
    id: node.id,
    typeName: "MediaImage",
    name: filenameFromUrl(node.image?.url) || node.alt || node.id,
    alt: node.alt,
    fileStatus: node.fileStatus,
    previewUrl: node.image?.url ?? null,
  };
}

export async function listShopifyFiles(
  admin: AdminGraphqlClient,
  mediaType: "MODEL3D" | "IMAGE",
  cursor?: string | null,
  pageSize = 100,
  searchTerm?: string,
): Promise<FileListResult> {
  const data = await adminGraphql<{
    files: {
      nodes: FileNode[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  }>(
    admin,
    `
      query ListSdl3dFiles($query: String!, $first: Int!, $after: String) {
        files(first: $first, after: $after, reverse: true, sortKey: CREATED_AT, query: $query) {
          nodes {
            __typename
            ... on Model3d {
              id
              alt
              fileStatus
              filename
              preview {
                image {
                  url
                }
              }
            }
            ... on MediaImage {
              id
              alt
              fileStatus
              image {
                url
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    { query: `media_type:${mediaType}${searchTerm ? ` ${searchTerm}` : ""}`, first: pageSize, after: cursor || null },
  );

  return {
    files: data.files.nodes.map(normalizeFileNode),
    hasNextPage: data.files.pageInfo.hasNextPage,
    endCursor: data.files.pageInfo.endCursor,
  };
}

/**
 * Load files related to a reference filename by extracting a prefix.
 * Strips extension and trailing digits/separators to find related files.
 */
export async function listRelatedFiles(
  admin: AdminGraphqlClient,
  mediaType: "MODEL3D" | "IMAGE",
  referenceFilename: string,
): Promise<FileListResult> {
  // Extract prefix: strip extension, then trailing digits/separators
  const base = referenceFilename.replace(/\.[^.]+$/, "");
  const prefix = base.replace(/[-_]?\d+$/, "").trim();
  if (!prefix) {
    return listShopifyFiles(admin, mediaType, null, 100);
  }
  return listShopifyFiles(admin, mediaType, null, 100, prefix);
}

/**
 * Paginate through ALL Shopify files matching a prefix (capped at 1000).
 */
export async function listAllShopifyFilesByPrefix(
  admin: AdminGraphqlClient,
  mediaType: "MODEL3D" | "IMAGE",
  prefix: string,
): Promise<ShopifyFileSummary[]> {
  const MAX_FILES = 1000;
  const allFiles: ShopifyFileSummary[] = [];
  let cursor: string | null = null;

  while (allFiles.length < MAX_FILES) {
    const result = await listShopifyFiles(admin, mediaType, cursor, 100, prefix);
    allFiles.push(...result.files);
    if (!result.hasNextPage || !result.endCursor) break;
    cursor = result.endCursor;
  }

  return allFiles.slice(0, MAX_FILES);
}

export async function uploadShopifyAdminFile(args: {
  admin: AdminGraphqlClient;
  file: File;
  kind: "MODEL_3D" | "IMAGE";
  alt?: string;
}) {
  const { admin, file, kind, alt = "" } = args;

  if (!file || file.size <= 0) {
    throw new Error("No file was uploaded.");
  }

  const stagedData = await adminGraphql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    admin,
    `
      mutation CreateStage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      input: [
        {
          filename: file.name,
          mimeType: normalizeUploadMimeType(file, kind),
          httpMethod: "POST",
          resource: kind === "MODEL_3D" ? "MODEL_3D" : "PRODUCT_IMAGE",
          ...(kind === "MODEL_3D" ? { fileSize: String(file.size) } : {}),
        },
      ],
    },
  );

  if (stagedData.stagedUploadsCreate.userErrors.length) {
    throw new Error(
      stagedData.stagedUploadsCreate.userErrors.map((e) => e.message).join("; "),
    );
  }

  const target = stagedData.stagedUploadsCreate.stagedTargets[0];
  if (!target) {
    throw new Error("Shopify did not return a staged upload target.");
  }

  const uploadForm = new FormData();
  for (const param of target.parameters) {
    uploadForm.append(param.name, param.value);
  }
  uploadForm.append("file", file, file.name);

  const uploadResponse = await fetch(target.url, {
    method: "POST",
    body: uploadForm,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(`Upload to staged target failed: ${uploadResponse.status} ${text}`);
  }

  const created = await adminGraphql<{
    fileCreate: {
      files: Array<
        | {
            __typename: "Model3d";
            id: string;
            fileStatus: string;
            filename: string;
            preview: { image: { url: string } | null } | null;
          }
        | {
            __typename: "MediaImage";
            id: string;
            fileStatus: string;
            image: { url: string } | null;
          }
      >;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    admin,
    `
      mutation CreateFile($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            __typename
            ... on Model3d {
              id
              fileStatus
              filename
              preview {
                image {
                  url
                }
              }
            }
            ... on MediaImage {
              id
              fileStatus
              image {
                url
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      files: [
        {
          alt,
          filename: file.name,
          contentType: kind,
          originalSource: target.resourceUrl,
        },
      ],
    },
  );

  if (created.fileCreate.userErrors.length) {
    throw new Error(created.fileCreate.userErrors.map((e) => e.message).join("; "));
  }

  const createdFile = created.fileCreate.files[0];
  if (!createdFile) {
    throw new Error("Shopify did not return a created file.");
  }

  return {
    id: createdFile.id,
    fileStatus: createdFile.fileStatus,
  };
}

export async function resolveSelectedAssetUrls(args: {
  admin: AdminGraphqlClient;
  modelFileGid?: string | null;
  posterFileGid?: string | null;
}) {
  const { admin, modelFileGid, posterFileGid } = args;
  const ids = [modelFileGid, posterFileGid].filter(Boolean) as string[];

  if (!ids.length) {
    return {
      modelSourceUrl: null as string | null,
      posterUrl: null as string | null,
    };
  }

  const data = await adminGraphql<{
    nodes: Array<
      | {
          __typename: "Model3d";
          id: string;
          sources: Array<{ url: string; format?: string | null }>;
          preview: { image: { url: string } | null } | null;
        }
      | {
          __typename: "MediaImage";
          id: string;
          image: { url: string } | null;
        }
      | null
    >;
  }>(
    admin,
    `
      query ResolveSelectedAssetUrls($ids: [ID!]!) {
        nodes(ids: $ids) {
          __typename
          ... on Model3d {
            id
            sources {
              url
              format
            }
            preview {
              image {
                url
              }
            }
          }
          ... on MediaImage {
            id
            image {
              url
            }
          }
        }
      }
    `,
    { ids },
  );

  let modelSourceUrl: string | null = null;
  let posterUrl: string | null = null;

  for (const node of data.nodes) {
    if (!node) continue;

    if (node.__typename === "Model3d" && node.id === modelFileGid) {
      const glb = node.sources.find((source) => (source.format || "").toLowerCase() === "glb");
      modelSourceUrl = glb?.url || node.sources[0]?.url || null;

      if (!posterUrl && node.preview?.image?.url) {
        posterUrl = node.preview.image.url;
      }
    }

    if (node.__typename === "MediaImage" && node.id === posterFileGid) {
      posterUrl = node.image?.url || null;
    }
  }

  return { modelSourceUrl, posterUrl };
}

/**
 * Slice 8 hotspots PR #4 — batch-resolve arbitrary Shopify file GIDs
 * to their public image URLs. Used by the editor loader for live-
 * preview of GID-typed hotspot icons, and by the publish path to
 * write resolved URLs into the metafield (TAE has no Admin API
 * access at render time).
 *
 * Filters down to MediaImage nodes only (icons are images by
 * contract); deleted / non-image GIDs simply drop from the map and
 * the storefront / editor fall back to the index-number dot.
 */
export async function resolveImageUrlsByGid(
  admin: AdminGraphqlClient,
  gids: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(gids.filter((g) => typeof g === "string" && g.startsWith("gid://shopify/"))));
  if (!unique.length) return {};

  const data = await adminGraphql<{
    nodes: Array<
      | { __typename: "MediaImage"; id: string; image: { url: string } | null }
      | { __typename: string; id: string }
      | null
    >;
  }>(
    admin,
    `
      query ResolveImageUrls($ids: [ID!]!) {
        nodes(ids: $ids) {
          __typename
          ... on MediaImage {
            id
            image { url }
          }
        }
      }
    `,
    { ids: unique },
  );

  const out: Record<string, string> = {};
  for (const node of data.nodes) {
    if (!node) continue;
    if (node.__typename === "MediaImage") {
      const url = (node as { image: { url: string } | null }).image?.url;
      if (url) out[node.id] = url;
    }
  }
  return out;
}