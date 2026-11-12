// src/services/exam/export.service.ts
import xlsx from 'node-xlsx';
import { listAttemptsForGrading } from './grading.service.js';
import { listExamViolations } from '../proctoring/stats.service.js';

export function formatSubmitReasonVi(reason?: string | null): string {
  switch (reason) {
    case 'time_up':
    case 'timeout':
      return 'Tự động nộp khi hết thời gian';
    case 'proctoring':
    case 'violation_threshold':
      return 'Tự động nộp do vượt ngưỡng vi phạm AI';
    case 'lecturer':
    case 'lecturer_force':
      return 'Giảng viên thu bài trực tiếp';
    case 'manual':
    default:
      return 'Thí sinh chủ động nộp bài';
  }
}

function formatGradingStatusVi(status?: string | null): string {
  if (status === 'graded') return 'Đã chấm xong';
  if (status === 'needs_manual') return 'Chờ chấm tự luận';
  return 'Đang xử lý';
}

function formatVerdictVi(verdict?: string | null): string {
  switch (verdict) {
    case 'confirmed_cheating':
      return 'Xác nhận gian lận';
    case 'suspected':
      return 'Cần xem xét';
    case 'clean':
      return 'Hợp lệ';
    default:
      return 'Chưa hậu kiểm';
  }
}

function formatSeverityVi(severity?: string | null): string {
  if (severity === 'critical') return 'Nghiêm trọng';
  if (severity === 'warning') return 'Cảnh báo';
  return 'Thông tin';
}

function formatEventReviewVi(status?: string | null): string {
  if (status === 'confirmed_cheating') return 'Xác nhận vi phạm';
  if (status === 'dismissed') return 'Đã bỏ qua (nhầm)';
  return 'Chờ duyệt';
}

function formatDateTimeVi(val?: string | Date | null): string {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleString('vi-VN', { hour12: false });
}

function sanitizeFileSlug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'report'
  );
}

export function toCsvBuffer(rows: Array<Array<string | number | null | undefined>>): Buffer {
  const lines = rows.map((row) =>
    row
      .map((cell) => {
        const raw = cell === null || cell === undefined ? '' : String(cell);
        // Chặn CSV Formula Injection nếu chuỗi bắt đầu bằng =, +, -, @
        const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
        if (/[",\r\n]/.test(safe)) {
          return `"${safe.replace(/"/g, '""')}"`;
        }
        return safe;
      })
      .join(','),
  );
  // Kèm UTF-8 BOM (\uFEFF) để Microsoft Excel trên Windows hiển thị tiếng Việt chuẩn dấu
  return Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8');
}

export async function buildGradingExport(examId: number, format: 'xlsx' | 'csv') {
  const { exam, submissions } = await listAttemptsForGrading(examId);
  const header = [
    'STT',
    'Mã sinh viên',
    'Họ và tên',
    'Thời gian bắt đầu',
    'Thời gian nộp bài',
    'Hình thức nộp bài',
    'Điểm trắc nghiệm',
    'Điểm tự luận / tệp',
    'Tổng điểm',
    'Điểm tối đa',
    'Trạng thái chấm',
    'Số cảnh báo AI',
    'Kết luận hậu kiểm',
  ];

  const dataRows = submissions.map((s: any, idx: number) => [
    idx + 1,
    s.student_code || '',
    s.student_name || '',
    formatDateTimeVi(s.started_at),
    formatDateTimeVi(s.submitted_at),
    formatSubmitReasonVi(s.submit_reason),
    Number(s.objective_score ?? 0),
    Number(s.essay_score ?? 0),
    Number(s.total_score ?? 0),
    Number(s.max_score ?? exam.max_score ?? 0),
    formatGradingStatusVi(s.grading_status),
    Number(s.violations_count ?? 0),
    formatVerdictVi(s.review_verdict),
  ]);

  const slug = sanitizeFileSlug(exam.name || `exam-${examId}`);
  if (format === 'csv') {
    return {
      buffer: toCsvBuffer([header, ...dataRows]),
      contentType: 'text/csv; charset=utf-8',
      filename: `bang-diem-${slug}.csv`,
    };
  }

  const avgScore =
    submissions.length > 0
      ? Math.round(
          (submissions.reduce((sum: number, s: any) => sum + Number(s.total_score ?? 0), 0) /
            submissions.length) *
            100,
        ) / 100
      : 0;

  const summaryRows = [
    ['Chỉ tiêu', 'Giá trị'],
    ['Tên đề thi', exam.name || ''],
    ['Lớp học phần', exam.class_name || ''],
    ['Thời lượng làm bài (phút)', Number(exam.duration_minutes ?? 0)],
    ['Sĩ số lớp', Number(exam.total_enrolled ?? 0)],
    ['Tổng bài đã nộp', submissions.length],
    ['Điểm trung bình', avgScore],
    ['Thời điểm xuất báo cáo', formatDateTimeVi(new Date())],
  ];

  const xlsxBuffer = xlsx.build([
    {
      name: 'Bang diem',
      data: [header, ...dataRows],
      options: {
        '!cols': [
          { wch: 6 },
          { wch: 16 },
          { wch: 26 },
          { wch: 20 },
          { wch: 20 },
          { wch: 32 },
          { wch: 16 },
          { wch: 16 },
          { wch: 12 },
          { wch: 12 },
          { wch: 18 },
          { wch: 14 },
          { wch: 20 },
        ],
      },
    },
    {
      name: 'Tong quan de thi',
      data: summaryRows,
      options: {
        '!cols': [{ wch: 28 }, { wch: 42 }],
      },
    },
  ]);

  return {
    buffer: Buffer.from(xlsxBuffer),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `bang-diem-${slug}.xlsx`,
  };
}

export async function buildViolationsExport(examId: number, format: 'xlsx' | 'csv') {
  const { exam, violations, analytics } = await listExamViolations(examId, { onlyFlagged: false });

  const header = [
    'STT',
    'Mã sự kiện',
    'Mã sinh viên',
    'Họ và tên',
    'Loại hành vi',
    'Mức độ',
    'Thời điểm bắt đầu',
    'Thời điểm kết thúc',
    'Thời lượng (giây)',
    'Thông số kỹ thuật AI',
    'Trạng thái duyệt',
    'Ghi chú giảng viên',
  ];

  const dataRows = violations.map((v: any, idx: number) => [
    idx + 1,
    v.event_id,
    v.student_code || '',
    v.student_name || '',
    v.event_label || v.event_type,
    formatSeverityVi(v.severity),
    formatDateTimeVi(v.timestamp),
    formatDateTimeVi(v.ended_at),
    Number(v.duration_seconds ?? 0),
    v.details?.description || '',
    formatEventReviewVi(v.review_status),
    v.review_note || '',
  ]);

  const slug = sanitizeFileSlug(exam.name || `exam-${examId}`);
  if (format === 'csv') {
    return {
      buffer: toCsvBuffer([header, ...dataRows]),
      contentType: 'text/csv; charset=utf-8',
      filename: `nhat-ky-vi-pham-${slug}.csv`,
    };
  }

  const categoryRows = [
    ['Nhóm hành vi AI', 'Số lượt ghi nhận', 'Tỷ trọng (%)', 'Tổng thời lượng (giây)'],
    ...(analytics?.categories ?? []).map((c: any) => [
      c.label,
      Number(c.count ?? 0),
      Number(c.percentage ?? 0),
      Number(c.totalDurationSec ?? 0),
    ]),
    [],
    ['Tổng khung hình đã phân tích', Number(analytics?.ai_health?.total_frames ?? 0), '', ''],
    ['Tổng khung hình AI lỗi (bỏ qua an toàn)', Number(analytics?.ai_health?.total_ai_errors ?? 0), '', ''],
  ];

  const xlsxBuffer = xlsx.build([
    {
      name: 'Nhat ky vi pham AI',
      data: [header, ...dataRows],
      options: {
        '!cols': [
          { wch: 6 },
          { wch: 12 },
          { wch: 16 },
          { wch: 26 },
          { wch: 30 },
          { wch: 14 },
          { wch: 20 },
          { wch: 20 },
          { wch: 16 },
          { wch: 38 },
          { wch: 18 },
          { wch: 30 },
        ],
      },
    },
    {
      name: 'Thong ke nhom hanh vi',
      data: categoryRows,
      options: {
        '!cols': [{ wch: 38 }, { wch: 18 }, { wch: 16 }, { wch: 22 }],
      },
    },
  ]);

  return {
    buffer: Buffer.from(xlsxBuffer),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `nhat-ky-vi-pham-${slug}.xlsx`,
  };
}

