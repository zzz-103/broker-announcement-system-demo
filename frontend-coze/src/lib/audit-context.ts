export type AuditSource = "qr" | "qr_poster";

export interface AuditContext {
  visitor_id?: string;
  source?: AuditSource;
}

const VISITOR_ID_KEY = "broker-audit-visitor-id";
const SOURCE_KEY = "broker-audit-source";
const QR_VISIT_MARKER_KEY = "broker-audit-qr-visit-recorded";

function isAuditSource(value: string | null): value is AuditSource {
  return value === "qr" || value === "qr_poster";
}

function createVisitorId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getAuditContext(): AuditContext {
  const storedVisitorId = window.sessionStorage.getItem(VISITOR_ID_KEY);
  const visitorId = storedVisitorId || createVisitorId();
  if (!storedVisitorId) window.sessionStorage.setItem(VISITOR_ID_KEY, visitorId);

  const querySource = new URLSearchParams(window.location.search).get("source");
  if (isAuditSource(querySource)) window.sessionStorage.setItem(SOURCE_KEY, querySource);
  const storedSource = window.sessionStorage.getItem(SOURCE_KEY);
  return isAuditSource(storedSource) ? { visitor_id: visitorId, source: storedSource } : { visitor_id: visitorId };
}

export function hasRecordedQrVisit(): boolean {
  return window.sessionStorage.getItem(QR_VISIT_MARKER_KEY) === "1";
}

export function markQrVisitRecorded(): void {
  window.sessionStorage.setItem(QR_VISIT_MARKER_KEY, "1");
}

export function clearQrVisitMarker(): void {
  window.sessionStorage.removeItem(QR_VISIT_MARKER_KEY);
}
