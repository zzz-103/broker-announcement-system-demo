/**
 * 展示层格式化工具。
 *
 * 普通用户页面统一使用本地时间与紧凑数量格式，原始 ISO 时间、
 * 毫秒和时区只在管理员日志或技术详情中展示。
 */

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 本地日期时间：2026-08-05 14:20
 * 无法解析时返回空字符串（调用方自行处理占位符）。
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 本地日期：2026-08-05
 */
export function formatDateOnly(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 紧凑月日：08-05，用于顶部导航“数据至 08-05”等紧凑场景。
 */
export function formatMonthDay(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 紧凑日期时间：08-05 14:20，用于表格等紧凑场景。
 */
export function formatShortDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 数量：1,385
 */
export function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}
