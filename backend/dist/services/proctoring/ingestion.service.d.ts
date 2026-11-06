export interface IngestionResult {
    warnings: Array<{
        type: string;
        severity: string;
        messageVi: string;
    }>;
    shouldAutoSubmit: boolean;
}
export declare function ingestFrame(attemptId: number, imageBuffer: Buffer): Promise<IngestionResult>;
//# sourceMappingURL=ingestion.service.d.ts.map