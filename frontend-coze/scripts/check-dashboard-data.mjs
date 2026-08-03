import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDashboardPackage } from "./validate-dashboard-data.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageArg = process.argv.slice(2).find((value) => value !== "--") || "public/dashboard-data";
const cwdPackage = resolve(process.cwd(), packageArg);
const packageRoot = existsSync(join(cwdPackage, "manifest.json"))
  ? cwdPackage
  : resolve(projectRoot, packageArg);

const fail = (message) => {
  console.error(`数据包校验失败：${message}`);
  process.exitCode = 1;
};

try {
  const { manifest, summary } = await validateDashboardPackage(packageRoot);
  console.log(JSON.stringify({ package: packageRoot, schema_version: manifest.schema_version, package_version: manifest.package_version, datasets: summary }, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
