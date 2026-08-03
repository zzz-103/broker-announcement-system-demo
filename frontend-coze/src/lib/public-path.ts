const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim().replace(/\/+$/, "") || "";

/** Prefix a public asset path for static deployments hosted below the domain root. */
export function publicAssetPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalized}` || "/";
}

export { basePath };
