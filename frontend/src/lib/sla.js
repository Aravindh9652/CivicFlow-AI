import { SLA_DEFAULT } from "./config";

export function slaDeadlineFrom(createdAt, severity, minutesMap = SLA_DEFAULT) {
  const mins = minutesMap[severity] || minutesMap.Medium || 1440;
  let created = Date.now();
  if (createdAt?.toDate) created = createdAt.toDate().getTime();
  else if (createdAt instanceof Date) created = createdAt.getTime();
  else if (typeof createdAt === "number") created = createdAt;
  else if (typeof createdAt === "string") created = Date.parse(createdAt) || created;
  return created + mins * 60 * 1000;
}

export function slaState(deadlineMs, status) {
  if (status === "Resolved" || status === "Rejected") {
    return { label: status, remainingMs: 0, breached: false };
  }
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) {
    return { label: "SLA BREACHED", remainingMs: 0, breached: true };
  }
  return { label: formatRemain(remainingMs), remainingMs, breached: false };
}

function formatRemain(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h remaining`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")} remaining`;
}
