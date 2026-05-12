import {
  S3Client,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
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

export type ListObjectsResult = {
  keys: string[];
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
  putObject(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void>;
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
      forcePathStyle: creds.provider !== "S3",
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

  async putObject(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
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
      keys: (result.Contents ?? []).map((o) => o.Key ?? "").filter(Boolean),
      isTruncated: Boolean(result.IsTruncated),
      nextContinuationToken: result.NextContinuationToken,
    };
  }
}

export function buildBackend(creds: StorageCredentials): StorageBackend {
  if (creds.provider === "SHOPIFY_FILES") {
    throw new Error("Shopify Files backend is not implemented yet.");
  }
  return new S3CompatibleBackend(creds);
}

export async function loadStorageForShop(shopId: string): Promise<StorageBackend | null> {
  const row = await prisma.shopStorage.findUnique({ where: { shopId } });
  if (!row) return null;
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
