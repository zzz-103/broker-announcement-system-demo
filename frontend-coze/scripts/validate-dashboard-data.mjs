import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const REQUIRED_DATASETS = [
  "overview",
  "filters",
  "tender_projects",
  "app_updates",
  "ai_analysis",
];

const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseVersion(value, label) {
  assert(typeof value === "string" && value.trim(), `${label} 缺失`);
  const major = value.split(".")[0];
  assert(major === "1", `${label}=${value} 不兼容`);
}

function validateDatasetDescriptor(key, descriptor) {
  assert(descriptor && typeof descriptor === "object", `${key} 缺少数据描述`);
  assert(typeof descriptor.file === "string" && SAFE_FILE_NAME.test(descriptor.file), `${key} 的 file 不是安全的 JSON 文件名`);
  assert(typeof descriptor.available === "boolean", `${key} 的 available 必须是布尔值`);
  assert(descriptor.record_count === null || typeof descriptor.record_count === "number", `${key} 的 record_count 格式错误`);
  if (descriptor.sha256 !== undefined && descriptor.sha256 !== null) {
    assert(typeof descriptor.sha256 === "string" && SHA256.test(descriptor.sha256), `${key} 的 sha256 格式错误`);
  }
  if (descriptor.bytes !== undefined) assert(Number.isInteger(descriptor.bytes) && descriptor.bytes >= 0, `${key} 的 bytes 格式错误`);
}

export async function validateDashboardPackage(packageRoot) {
  const root = resolve(packageRoot);
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(manifest && typeof manifest === "object", "manifest.json 必须是对象");
  parseVersion(manifest.schema_version, "schema_version");
  parseVersion(manifest.minimum_reader_version, "minimum_reader_version");
  assert(typeof manifest.generated_at === "string" && manifest.generated_at, "manifest.json 缺少 generated_at");
  assert(manifest.datasets && typeof manifest.datasets === "object", "manifest.json 缺少 datasets");

  const summary = {};
  for (const key of REQUIRED_DATASETS) {
    const descriptor = manifest.datasets[key];
    validateDatasetDescriptor(key, descriptor);
    const filePath = join(root, descriptor.file);
    if (!existsSync(filePath)) {
      assert(!descriptor.available, `${key} 的文件不存在：${descriptor.file}`);
      summary[key] = { available: false, record_count: descriptor.record_count ?? null };
      continue;
    }

    const bytes = await readFile(filePath);
    if (descriptor.bytes !== undefined) assert(bytes.byteLength === descriptor.bytes, `${descriptor.file} 字节数不匹配`);
    if (descriptor.sha256) {
      const digest = createHash("sha256").update(bytes).digest("hex");
      assert(digest === descriptor.sha256, `${descriptor.file} sha256 不匹配`);
    }
    const value = JSON.parse(bytes.toString("utf8"));
    if (key === "tender_projects" || key === "app_updates") {
      assert(Array.isArray(value), `${descriptor.file} 必须是数组`);
      if (typeof descriptor.record_count === "number") assert(value.length === descriptor.record_count, `${descriptor.file} 记录数不匹配`);
      assert(value.every((row) => row && typeof row === "object" && typeof row.id === "string"), `${descriptor.file} 包含无法识别的记录`);
    } else if (key === "overview" || key === "filters") {
      assert(value && typeof value === "object" && value.schema_version === manifest.schema_version, `${descriptor.file} 与 manifest.json 版本不一致`);
    } else {
      assert(value && typeof value === "object" && !Array.isArray(value), `${descriptor.file} 必须是对象`);
    }
    summary[key] = { available: descriptor.available, record_count: descriptor.record_count ?? null };
  }
  return { root, manifest, summary };
}
