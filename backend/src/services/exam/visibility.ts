// src/services/exam/visibility.ts
// Quy tắc công bố điểm & xem lại đáp án thuần (không I/O), dùng chung cho attempt.service,
// exam.routes và unit test để đảm bảo không lộ điểm khi result_visibility = hidden / after_close.

export type ResultVisibilityMode = 'immediately' | 'after_close' | 'hidden';

export interface VisibilityCheckInput {
  attemptStatus: string;
  resultVisibility: ResultVisibilityMode | string | null | undefined;
  allowReview: boolean | null | undefined;
  examEndTime: Date | string;
  now?: Date;
}

export interface VisibilityCheckResult {
  isSubmitted: boolean;
  canSeeScore: boolean;
  canReviewAnswers: boolean;
  reason: string | null;
}

export function computeStudentResultVisibility(input: VisibilityCheckInput): VisibilityCheckResult {
  const now = input.now ?? new Date();
  const isSubmitted = input.attemptStatus !== 'in_progress';
  const mode = input.resultVisibility ?? 'after_close';
  const examClosed = now >= new Date(input.examEndTime);

  const canSeeScore = isSubmitted && (
    mode === 'immediately' ||
    (mode === 'after_close' && examClosed)
  );
  const canReviewAnswers = canSeeScore && Boolean(input.allowReview);

  const reason = !isSubmitted
    ? null
    : canSeeScore
      ? null
      : mode === 'hidden'
        ? 'Điểm số bài thi này được ẩn theo cấu hình của giảng viên.'
        : 'Điểm số sẽ được công bố sau khi kỳ thi kết thúc.';

  return {
    isSubmitted,
    canSeeScore,
    canReviewAnswers,
    reason,
  };
}

