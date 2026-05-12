export type StorageProvider = "DO_SPACES" | "S3" | "R2" | "BUNNY" | "SHOPIFY_FILES";

export const STORAGE_PROVIDERS: ReadonlyArray<{
  value: StorageProvider;
  label: string;
  comingSoon?: boolean;
}> = [
  { value: "DO_SPACES", label: "DigitalOcean Spaces" },
  { value: "S3", label: "AWS S3" },
  { value: "R2", label: "Cloudflare R2" },
  { value: "BUNNY", label: "Bunny.net Storage" },
  { value: "SHOPIFY_FILES", label: "Shopify Files (coming soon)", comingSoon: true },
];
