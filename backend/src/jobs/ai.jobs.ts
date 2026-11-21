// src/jobs/ai.jobs.ts
import { resumePendingIngestionsOnStartup } from '../services/ai/ingestion.service.js';

export function startAiJobs(): void {
  setTimeout(() => {
    void resumePendingIngestionsOnStartup().catch((err) => {
      console.warn('[ai-jobs] Không thể khôi phục hàng đợi index tài liệu:', err?.message);
    });
  }, 1500);
}
