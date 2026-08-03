import type {
  AppUpdateData,
  DashboardAiAnalysis,
  DashboardDatasetKey,
  DashboardFilters,
  DashboardManifest,
  DashboardOverview,
  TenderProjectData,
} from "@dashboard-data/contracts";

export class DashboardDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardDataError";
  }
}

type DatasetValue = DashboardOverview | DashboardFilters | TenderProjectData[] | AppUpdateData[] | DashboardAiAnalysis;
const DATASET_KEYS: DashboardDatasetKey[] = ["overview", "filters", "tender_projects", "app_updates", "ai_analysis"];
const cache = new Map<string, Promise<unknown>>();
let importedFiles: Map<string, File> | null = null;
let sourceVersion = "deployed";

function isSafeDatasetFileName(value: string): boolean {
  return value === normalizePath(value) && /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(value);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^.*?dashboard-data\//, "");
}

function deployedUrl(fileName: string): string {
  return new URL(`./dashboard-data/${fileName}`, document.baseURI).toString();
}

export function getImportedPackage(): boolean { return importedFiles !== null; }

export function invalidateStaticPackageCache(): void {
  cache.clear();
}

export function resetStaticPackage(): void {
  importedFiles = null;
  sourceVersion = "deployed";
  invalidateStaticPackageCache();
}

export function importStaticPackage(files: FileList | File[]): void {
  const next = new Map<string, File>();
  for (const file of Array.from(files)) {
    const relative = normalizePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    next.set(relative, file);
  }
  if (!next.has("manifest.json")) throw new DashboardDataError("导入失败：目录中缺少 dashboard-data/manifest.json。");
  importedFiles = next;
  sourceVersion = `imported-${Date.now()}`;
  invalidateStaticPackageCache();
}

async function readFile(fileName: string): Promise<string> {
  return (await readFileBytes(fileName)).text;
}

async function readFileBytes(fileName: string): Promise<{ text: string; bytes: ArrayBuffer }> {
  if (importedFiles) {
    const file = importedFiles.get(normalizePath(fileName));
    if (!file) throw new DashboardDataError(`数据文件缺失：${fileName}。请重新选择完整的 dashboard-data 目录。`);
    const bytes = await file.arrayBuffer();
    return { text: new TextDecoder().decode(bytes), bytes };
  }
  let response: Response;
  try {
    response = await fetch(deployedUrl(fileName), { cache: "no-cache" });
  } catch {
    throw new DashboardDataError("无法读取静态数据包，请确认当前站点包含 dashboard-data 目录。");
  }
  if (!response.ok) {
    throw new DashboardDataError(response.status === 404 ? `部署数据缺失：${fileName}。请复制完整的 dashboard-data 目录。` : `数据文件加载失败：${fileName}（HTTP ${response.status}）。`);
  }
  const bytes = await response.arrayBuffer();
  return { text: new TextDecoder().decode(bytes), bytes };
}

async function verifyChecksum(fileName: string, bytes: ArrayBuffer, expected: string): Promise<void> {
  if (!expected || !globalThis.crypto?.subtle) return;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new DashboardDataError(`数据文件校验失败：${fileName} 已损坏或与 manifest.json 不匹配。`);
}

function parseJson<T>(fileName: string, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DashboardDataError(`数据文件格式错误：${fileName} 不是有效 JSON。`);
  }
}

function assertManifest(value: unknown): DashboardManifest {
  if (!value || typeof value !== "object") throw new DashboardDataError("manifest.json 格式错误：必须是对象。");
  const manifest = value as Partial<DashboardManifest>;
  if (typeof manifest.schema_version !== "string" || typeof manifest.minimum_reader_version !== "string" || typeof manifest.generated_at !== "string" || !manifest.datasets || typeof manifest.datasets !== "object") {
    throw new DashboardDataError("manifest.json 缺少必要字段，无法读取数据包。");
  }
  if (manifest.schema_version.split(".")[0] !== "1") throw new DashboardDataError(`数据包版本 ${manifest.schema_version} 不兼容，当前前端仅支持 1.x。`);
  if (manifest.minimum_reader_version.split(".")[0] !== "1") throw new DashboardDataError("数据包要求更高版本的前端，请更新纯前端看板。");
  for (const key of DATASET_KEYS) {
    const dataset = manifest.datasets[key];
    if (!dataset || typeof dataset.file !== "string" || typeof dataset.available !== "boolean" || !isSafeDatasetFileName(dataset.file)) throw new DashboardDataError(`manifest.json 中的 ${key} 文件名无效，无法安全读取。`);
  }
  return manifest as DashboardManifest;
}

export async function loadStaticManifest(): Promise<DashboardManifest> {
  const key = `${sourceVersion}:manifest`;
  const pending = cache.get(key);
  if (pending) return pending as Promise<DashboardManifest>;
  const promise = readFile("manifest.json").then((text) => assertManifest(parseJson<unknown>("manifest.json", text)));
  cache.set(key, promise);
  return promise;
}

export async function loadStaticDataset<K extends DashboardDatasetKey>(key: K): Promise<Extract<DatasetValue, K extends "overview" ? DashboardOverview : K extends "filters" ? DashboardFilters : K extends "tender_projects" ? TenderProjectData[] : K extends "app_updates" ? AppUpdateData[] : DashboardAiAnalysis>> {
  const cacheKey = `${sourceVersion}:${key}`;
  const pending = cache.get(cacheKey);
  if (pending) return pending as ReturnType<typeof loadStaticDataset<K>>;
  const promise = loadStaticManifest().then(async (manifest) => {
    const dataset = manifest.datasets[key];
    if (!dataset.available) {
      if (key === "app_updates") return [] as unknown as DatasetValue;
      if (key === "ai_analysis") return { content: null, updated_at: null, meta: null } as unknown as DatasetValue;
      throw new DashboardDataError(dataset.reason || `${key} 数据不可用。`);
    }
    const file = await readFileBytes(dataset.file);
    await verifyChecksum(dataset.file, file.bytes, dataset.sha256);
    const value = parseJson<DatasetValue>(dataset.file, file.text);
    if (key === "tender_projects" || key === "app_updates") {
      if (!Array.isArray(value)) throw new DashboardDataError(`数据文件格式错误：${dataset.file} 必须是数组。`);
      if (typeof dataset.record_count === "number" && value.length !== dataset.record_count) throw new DashboardDataError(`数据文件记录数异常：${dataset.file}。`);
      if (value.some((row) => !row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string")) throw new DashboardDataError(`数据文件格式错误：${dataset.file} 包含无法识别的记录。`);
    }
    if (key === "overview" || key === "filters") {
      if (!value || typeof value !== "object" || (value as { schema_version?: unknown }).schema_version !== manifest.schema_version) throw new DashboardDataError(`数据文件格式错误：${dataset.file} 与 manifest.json 版本不一致。`);
    }
    return value;
  });
  cache.set(cacheKey, promise);
  return promise as ReturnType<typeof loadStaticDataset<K>>;
}
