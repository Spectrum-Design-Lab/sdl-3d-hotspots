import {
  S3Client,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

import prisma from "../db.server";
import { decrypt } from "./storage-encryption.server";
import type { StorageProvider } from "./storage-shared";

export { STORAGE_PROVIDERS, type StorageProvider } from "./storage-shared";

export type StorageCredentials = {
  provider: StorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicBaseUrl?: string | null;
};

export type SignPutOptions = {
  key: string;
  contentType?: string;
  expiresInSeconds?: number;
};

/**
 * Per-object visibility. DO Spaces / S3 / R2 default to "private" — objects
 * uploaded that way are only retrievable by callers with the SDK credentials
 * (the worker can `getObject`, but anonymous browser/storefront fetches return
 * 403). Processed frames and the manifest must be `"public-read"` so the
 * storefront viewer can load them by URL. Raw merchant uploads stay private.
 */
export type ObjectVisibility = "private" | "public-read";

export type PutObjectOptions = {
  contentType?: string;
  acl?: ObjectVisibility;
  /**
   * `Cache-Control` header to write on the object. Frame URLs are
   * content-addressed (keyed by captureId, which never gets reused) so the
   * pipeline passes `"public, max-age=31536000, immutable"` — lets browsers
   * and any CDN in front of the bucket cache them forever. Defaults to
   * undefined (no header).
   */
  cacheControl?: string;
};

/** Long-lived cache header for processed frames + manifests. Content-addressed
 *  by captureId so it's safe to mark immutable. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type StorageObject = {
  key: string;
  size: number;
};

export type ListObjectsResult = {
  objects: StorageObject[];
  isTruncated: boolean;
  nextContinuationToken?: string;
};

export interface StorageBackend {
  readonly provider: StorageProvider;
  readonly bucket: string;
  readonly publicBaseUrl: string | null;
  headBucket(): Promise<void>;
  signPutUrl(opts: SignPutOptions): Promise<string>;
  getObject(key: string): Promise<Readable>;
  /**
   * Upload a single object. Pass either a content-type string (back-compat
   * shorthand) or a {@link PutObjectOptions} bag. Frames + manifests use
   * `acl: "public-read"`; everything else stays private by default.
   */
  putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentTypeOrOptions?: string | PutObjectOptions,
  ): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string, continuationToken?: string): Promise<ListObjectsResult>;
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export class S3CompatibleBackend implements StorageBackend {
  readonly provider: StorageProvider;
  readonly bucket: string;
  readonly publicBaseUrl: string | null;
  private readonly client: S3Client;

  constructor(creds: StorageCredentials) {
    this.provider = creds.provider;
    this.bucket = creds.bucket;
    this.publicBaseUrl = creds.publicBaseUrl?.trim() || null;
    this.client = new S3Client({
      endpoint: normalizeEndpoint(creds.endpoint),
      region: creds.region || "us-east-1",
      credentials: {
        accessKeyId: creds.accessKey,
        secretAccessKey: creds.secretKey,
      },
      // DO Spaces, R2, and S3 default to virtual-host-style addressing
      // (<bucket>.<endpoint>). Bunny.net's S3-compatible API requires
      // path-style. HeadBucket on DO Spaces returns 404 under path-style.
      forcePathStyle: creds.provider === "BUNNY",
    });
  }

  async headBucket(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async signPutUrl({ key, contentType, expiresInSeconds = 900 }: SignPutOptions): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async getObject(key: string): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) {
      throw new Error(`getObject: empty body for ${key}`);
    }
    return result.Body as Readable;
  }

  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentTypeOrOptions?: string | PutObjectOptions,
  ): Promise<void> {
    const opts: PutObjectOptions =
      typeof contentTypeOrOptions === "string"
        ? { contentType: contentTypeOrOptions }
        : (contentTypeOrOptions ?? {});

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ACL: opts.acl,
        CacheControl: opts.cacheControl,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async listObjects(prefix: string, continuationToken?: string): Promise<ListObjectsResult> {
    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    return {
      objects: (result.Contents ?? [])
        .map((o) => ({ key: o.Key ?? "", size: o.Size ?? 0 }))
        .filter((o) => o.key.length > 0),
      isTruncated: Boolean(result.IsTruncated),
      nextContinuationToken: result.NextContinuationToken,
    };
  }
}

const FRAME_IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const DEFAULT_MIN_FRAMES = 24;
const DEFAULT_MAX_PAGES = 10;

export type FrameBearingFolder = {
  prefix: string;
  name: string;
  frameKeys: string[];
  totalBytes: number;
};

/**
 * Walk a bucket prefix, group image keys by their parent folder, and return
 * folders that look like frame sequences (≥ minFrames image files in one
 * folder). Frame keys come back natural-numeric sorted so `frame_2.jpg`
 * orders before `frame_10.jpg`.
 *
 * Paginated. Caps at maxPages (default 10 = 10k keys) to keep latency
 * bounded on huge buckets — caller gets `truncated: true` so the UI can
 * tell the merchant to narrow the prefix.
 */
export async function listFrameBearingFolders(
  backend: StorageBackend,
  prefix: string,
  opts: { minFrames?: number; maxPages?: number } = {},
): Promise<{ folders: FrameBearingFolder[]; truncated: boolean }> {
  const minFrames = opts.minFrames ?? DEFAULT_MIN_FRAMES;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;

  const byFolder = new Map<string, { keys: string[]; bytes: number }>();
  let token: string | undefined;
  let pages = 0;
  let truncated = false;

  // Pagination loop — exits when no continuation token OR maxPages
  // hit. Constant condition is the intent.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await backend.listObjects(prefix, token);
    pages += 1;
    for (const obj of page.objects) {
      if (!FRAME_IMAGE_RE.test(obj.key)) continue;
      const slash = obj.key.lastIndexOf("/");
      if (slash < 0) continue;
      const parent = obj.key.substring(0, slash);
      const entry = byFolder.get(parent) ?? { keys: [], bytes: 0 };
      entry.keys.push(obj.key);
      entry.bytes += obj.size;
      byFolder.set(parent, entry);
    }
    if (!page.isTruncated || !page.nextContinuationToken) break;
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    token = page.nextContinuationToken;
  }

  const folders: FrameBearingFolder[] = [];
  for (const [folderPrefix, entry] of byFolder.entries()) {
    if (entry.keys.length < minFrames) continue;
    const sortedKeys = [...entry.keys].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    const lastSlash = folderPrefix.lastIndexOf("/");
    const name = lastSlash >= 0 ? folderPrefix.substring(lastSlash + 1) : folderPrefix;
    folders.push({
      prefix: folderPrefix,
      name,
      frameKeys: sortedKeys,
      totalBytes: entry.bytes,
    });
  }
  folders.sort((a, b) => a.prefix.localeCompare(b.prefix));

  return { folders, truncated };
}

export function buildBackend(creds: StorageCredentials): StorageBackend {
  if (creds.provider === "SHOPIFY_FILES") {
    throw new Error("Shopify Files backend is not implemented yet.");
  }
  return new S3CompatibleBackend(creds);
}

type ShopStorageRow = {
  id: string;
  provider: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyEncrypted: Buffer | Uint8Array;
  secretKeyEncrypted: Buffer | Uint8Array;
  publicBaseUrl: string | null;
};

function rowToBackend(row: ShopStorageRow): StorageBackend {
  return buildBackend({
    provider: row.provider as StorageProvider,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    accessKey: decrypt(row.accessKeyEncrypted),
    secretKey: decrypt(row.secretKeyEncrypted),
    publicBaseUrl: row.publicBaseUrl,
  });
}

/**
 * Load the shop's default storage backend. Captures / signRawUpload use this
 * when a capture has no `storageId` of its own. Returns null if the shop has
 * no storage configured at all, or — defensively — if no row carries
 * isDefault (should never happen given the setDefault transaction).
 */
export async function loadDefaultStorageForShop(
  shopId: string,
): Promise<StorageBackend | null> {
  const row = await prisma.shopStorage.findFirst({
    where: { shopId, isDefault: true },
  });
  if (!row) {
    const anyRow = await prisma.shopStorage.findFirst({ where: { shopId } });
    if (anyRow) {
      console.warn(
        `[storage] shop ${shopId} has storage rows but none isDefault — falling back to most-recently-updated row ${anyRow.id}.`,
      );
      return rowToBackend(anyRow);
    }
    return null;
  }
  return rowToBackend(row);
}

/**
 * Look up the shop's default storage row id without decrypting credentials.
 * Used at signRawUpload time to stamp the resulting Capture so the worker
 * reads from the bucket that was the default when the upload started — even
 * if the merchant flips the default mid-job. Returns null if the shop has no
 * default row configured.
 */
export async function getDefaultStorageRowId(
  shopId: string,
): Promise<string | null> {
  const row = await prisma.shopStorage.findFirst({
    where: { shopId, isDefault: true },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Load a specific storage row by id. Captures use this once they've been
 * stamped with a storageId so the worker reads from the bucket that was the
 * default when the upload started, even if the merchant flips the default
 * mid-job.
 */
export async function loadStorageForShopById(
  shopId: string,
  storageId: string,
): Promise<StorageBackend | null> {
  const row = await prisma.shopStorage.findFirst({
    where: { id: storageId, shopId },
  });
  if (!row) return null;
  return rowToBackend(row);
}

/**
 * Load a specific storage row by provider. Used by the storage page's
 * test-connection flow on a saved row, and (in 5C) by the editor top-bar
 * storage selector.
 */
export async function loadStorageForShopByProvider(
  shopId: string,
  provider: StorageProvider,
): Promise<StorageBackend | null> {
  const row = await prisma.shopStorage.findUnique({
    where: { shopId_provider: { shopId, provider } },
  });
  if (!row) return null;
  return rowToBackend(row);
}

export type ShopStorageSummary = {
  id: string;
  provider: StorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  publicBaseUrl: string | null;
  testedAt: string | null;
  updatedAt: string;
  isDefault: boolean;
};

/**
 * Lightweight list of the shop's configured storage rows, for the storage
 * page's list UI. Sorted default-first, then by most-recently-updated. Never
 * returns decrypted credentials.
 */
export async function listStoragesForShop(
  shopId: string,
): Promise<ShopStorageSummary[]> {
  const rows = await prisma.shopStorage.findMany({
    where: { shopId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      provider: true,
      endpoint: true,
      region: true,
      bucket: true,
      publicBaseUrl: true,
      testedAt: true,
      updatedAt: true,
      isDefault: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider as StorageProvider,
    endpoint: r.endpoint,
    region: r.region,
    bucket: r.bucket,
    publicBaseUrl: r.publicBaseUrl,
    testedAt: r.testedAt ? r.testedAt.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
    isDefault: r.isDefault,
  }));
}
