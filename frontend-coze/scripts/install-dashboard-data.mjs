import { cp, mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDashboardPackage } from "./validate-dashboard-data.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceArg = process.argv.slice(2).find((value) => value !== "--") || "backend/data/dashboard-data";
const cwdSource = resolve(process.cwd(), sourceArg);
const source = existsSync(resolve(cwdSource, "manifest.json")) ? cwdSource : resolve(projectRoot, sourceArg);
const target = resolve(projectRoot, "frontend-coze/public/dashboard-data");
const targetParent = dirname(target);
const suffix = `${process.pid}-${Date.now()}`;
const staging = resolve(targetParent, `.dashboard-data-stage-${suffix}`);
const backup = resolve(targetParent, `.dashboard-data-backup-${suffix}`);

try {
  const { manifest } = await validateDashboardPackage(source);
  if (source === target) {
    console.log(`标准化数据包已在目标目录：${target}`);
    process.exit(0);
  }
  await mkdir(targetParent, { recursive: true });
  await cp(source, staging, { recursive: true, force: true });
  let backedUp = false;
  let committed = false;
  try {
    if (existsSync(target)) {
      await rename(target, backup);
      backedUp = true;
    }
    await rename(staging, target);
    committed = true;
  } catch (error) {
    if (backedUp && !existsSync(target) && existsSync(backup)) {
      await rename(backup, target);
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
    if (committed && backedUp) {
      try {
        await rm(backup, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn(`旧数据包备份清理失败：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }
  }
  console.log(`已复制标准化数据包：${source} -> ${target}`);
  console.log(`版本 ${manifest.package_version}，生成于 ${manifest.generated_at}`);
} catch (error) {
  console.error(`数据包复制失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
