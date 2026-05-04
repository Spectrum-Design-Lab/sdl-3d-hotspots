import prisma from "../db.server";
import { uploadShopifyAdminFile } from "./sdl3d-files.server";
import type { AdminGraphqlClient } from "./sdl3d-graphql.server";
import type { ImageSequenceFrame } from "./sdl3d-shared";

/**
 * Sort filenames by numeric suffix for turntable sequences.
 * e.g. "product_001.jpg" before "product_002.jpg"
 */
function extractFrameIndex(filename: string): number {
  const match = filename.match(/(\d+)\.[^.]+$/);
  return match ? parseInt(match[1], 10) : 0;
}

export function sortFramesByFilename(
  files: Array<{ name: string; index?: number }>,
): Array<{ name: string; index: number }> {
  return files
    .map((f, i) => ({ name: f.name, index: extractFrameIndex(f.name) || i }))
    .sort((a, b) => a.index - b.index)
    .map((f, i) => ({ ...f, index: i }));
}

/**
 * Upload multiple images as an image sequence and save to ProductConfig.
 * Each file is uploaded to Shopify individually, then the ordered list of
 * GIDs and URLs is stored as JSON on ProductConfig.imageSequenceJson.
 */
export async function uploadImageSequence(args: {
  admin: AdminGraphqlClient;
  productConfigId: string;
  files: File[];
}) {
  const { admin, productConfigId, files } = args;

  if (!files.length) {
    throw new Error("No image files provided.");
  }

  // Sort by filename to maintain turntable order
  const sorted = [...files].sort((a, b) => {
    const aIdx = extractFrameIndex(a.name);
    const bIdx = extractFrameIndex(b.name);
    return aIdx - bIdx;
  });

  const frames: ImageSequenceFrame[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const file = sorted[i];
    const created = await uploadShopifyAdminFile({
      admin,
      file,
      kind: "IMAGE",
      alt: `360° frame ${i + 1} - ${file.name}`,
    });

    frames.push({
      index: i,
      imageGid: created.id,
      imageUrl: "", // URL resolved after processing
    });

    // Throttle between uploads to avoid Shopify API rate limits
    if (i < sorted.length - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const imageSequenceJson = JSON.stringify(frames);

  await prisma.productConfig.update({
    where: { id: productConfigId },
    data: {
      imageSequenceJson,
      frameCount: frames.length,
      viewerType: "IMAGE_360",
    },
  });

  // Return filenames alongside frames for folder association
  const uploadedFiles = sorted.map((file, i) => ({
    filename: file.name,
    shopifyFileGid: frames[i].imageGid,
  }));

  return { frames, frameCount: frames.length, uploadedFiles };
}

/**
 * Resolve image URLs for an image sequence from Shopify file GIDs.
 */
export async function resolveImageSequenceUrls(args: {
  admin: AdminGraphqlClient;
  imageSequenceJson: string;
}): Promise<ImageSequenceFrame[]> {
  const { admin, imageSequenceJson } = args;

  let frames: ImageSequenceFrame[];
  try {
    frames = JSON.parse(imageSequenceJson);
  } catch {
    return [];
  }

  if (!Array.isArray(frames) || !frames.length) return [];

  // If URLs are already populated, return as-is
  if (frames.every((f) => f.imageUrl)) return frames;

  // Batch resolve GIDs to URLs (Shopify nodes() query limited to 250 IDs)
  const { adminGraphql } = await import("./sdl3d-graphql.server");

  const gids = frames.map((f) => f.imageGid).filter(Boolean);
  if (!gids.length) return frames;

  const BATCH_SIZE = 250;
  const urlMap = new Map<string, string>();

  for (let i = 0; i < gids.length; i += BATCH_SIZE) {
    const batch = gids.slice(i, i + BATCH_SIZE);
    const data = await adminGraphql<{
      nodes: Array<{
        __typename: string;
        id: string;
        image?: { url: string } | null;
      } | null>;
    }>(
      admin,
      `
        query ResolveImageSequenceUrls($ids: [ID!]!) {
          nodes(ids: $ids) {
            __typename
            ... on MediaImage {
              id
              image {
                url
              }
            }
          }
        }
      `,
      { ids: batch },
    );

    for (const node of data.nodes) {
      if (node && node.__typename === "MediaImage" && node.image?.url) {
        urlMap.set(node.id, node.image.url);
      }
    }
  }

  return frames.map((f) => ({
    ...f,
    imageUrl: (f.imageGid && urlMap.get(f.imageGid)) || f.imageUrl,
  }));
}
