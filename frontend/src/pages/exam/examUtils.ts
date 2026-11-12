// Tiện ích dùng chung cho module Thi trực tuyến & Giám sát AI

export function formatSubmitReason(reason?: string | null, short = false): string {
  switch (reason) {
    case 'time_up':
    case 'timeout':
      return short ? 'Hết thời gian' : 'Tự động nộp khi hết thời gian';
    case 'proctoring':
    case 'violation_threshold':
      return short ? 'Vượt ngưỡng vi phạm AI' : 'Tự động nộp do vượt ngưỡng vi phạm AI';
    case 'lecturer':
    case 'lecturer_force':
      return short ? 'Giảng viên thu bài' : 'Giảng viên thu bài trực tiếp';
    case 'manual':
    default:
      return short ? 'Chủ động nộp' : 'Thí sinh chủ động nộp bài';
  }
}

export function triggerBlobDownload(
  blob: Blob,
  fallbackFilename: string,
  contentDisposition?: string,
): void {
  let filename = fallbackFilename;
  if (contentDisposition) {
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
    if (utf8Match?.[1]) {
      try {
        filename = decodeURIComponent(utf8Match[1].trim());
      } catch {
        filename = utf8Match[1].trim();
      }
    } else {
      const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
      if (match?.[1]) {
        filename = match[1].trim();
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function extractAnswerFileName(filePath?: string | null): string {
  if (!filePath) return '';
  const normalized = String(filePath).replace(/\\/g, '/');
  const base = normalized.split('/').pop() || normalized;
  const sepIdx = base.indexOf('__');
  return sepIdx >= 0 && sepIdx + 2 < base.length ? base.slice(sepIdx + 2) : base;
}

export function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

