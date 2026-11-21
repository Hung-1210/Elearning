// src/services/ai/chunker.ts
import type { ExtractedPage } from './text-extract.js';

export interface DocumentChunk {
  chunkIndex: number;
  heading: string | null;
  pageFrom: number;
  pageTo: number;
  content: string;
  embedInput: string;
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens?: number; // mặc định ~300 token (~1200 ký tự, tương đương 200-250 từ)
  overlapTokens?: number; // mặc định ~50 token (~200 ký tự)
  maxPagesPerChunk?: number; // tối đa 2 trang/slide mỗi chunk để vector tập trung đúng chủ đề
}

/** Ước lượng số token (~1 token / 4 ký tự tiếng Việt/Anh). */
export function estimateTokenCount(text: string): number {
  const cleaned = (text || '').trim();
  if (!cleaned) return 0;
  return Math.max(1, Math.ceil(cleaned.length / 4));
}

/** Nhận diện dòng tiêu đề chương/mục trong tài liệu học thuật tiếng Việt & tiếng Anh. */
export function detectHeadingLine(line: string): string | null {
  const trimmed = line.replace(/^#+\s*/, '').trim();
  if (!trimmed || trimmed.length < 3 || trimmed.length > 110) return null;

  // Markdown heading
  if (/^#{1,4}\s+.+/.test(line.trim())) {
    return trimmed;
  }

  // Mẫu: Chương 1..., Bài 2..., Phần I..., Mục 1.2..., Chapter 1..., Lecture 2...
  if (
    /^(chương|bài|phần|mục|chuyên đề|chapter|unit|lecture|part|section)\s+([0-9IVXLCDM]+|[a-zA-Z])\b/i.test(
      trimmed,
    )
  ) {
    return trimmed;
  }

  // Mẫu đánh số mục: 1. Giới thiệu / 1.1. Khái niệm / I. Tổng quan (không kết thúc bằng dấu chấm câu dài)
  if (
    /^(\d{1,2}(\.\d{1,2}){0,2}|[IVX]{1,4})\.\s+[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/.test(
      trimmed,
    ) &&
    trimmed.length <= 90 &&
    !/[.;:?]$/.test(trimmed)
  ) {
    return trimmed;
  }

  // Dòng IN HOA ngắn (<= 75 ký tự, chứa ít nhất 2 từ chữ cái)
  const lettersOnly = trimmed.replace(/[^A-Za-zÀ-ỹ]/g, '');
  if (
    lettersOnly.length >= 6 &&
    trimmed.length <= 75 &&
    trimmed === trimmed.toUpperCase() &&
    trimmed !== trimmed.toLowerCase() &&
    !/[,;]$/.test(trimmed)
  ) {
    return trimmed;
  }

  return null;
}

export function cleanDisplayFileName(rawFileName: string): string {
  const base = rawFileName.includes('/') ? rawFileName.split('/').pop()! : rawFileName;
  return base.replace(/^\d{10,15}-/, '');
}

/** Chia danh sách trang văn bản thành các chunk có chồng lấn (overlap) và gắn tiêu đề mục + số trang. */
export function chunkDocumentPages(
  pages: ExtractedPage[],
  rawFileName: string,
  opts?: ChunkOptions,
): DocumentChunk[] {
  const targetTokens = opts?.targetTokens ?? 300;
  const overlapTokens = opts?.overlapTokens ?? 50;
  const maxPagesPerChunk = opts?.maxPagesPerChunk ?? 2;
  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;
  const displayFile = cleanDisplayFileName(rawFileName);

  interface ParagraphUnit {
    page: number;
    heading: string | null;
    text: string;
  }

  const units: ParagraphUnit[] = [];
  let currentHeading: string | null = null;

  for (const p of pages) {
    const rawLines = (p.text || '').replace(/\r\n/g, '\n').split('\n');
    let bufferLines: string[] = [];

    const flushParagraph = () => {
      if (bufferLines.length === 0) return;
      const joined = bufferLines.join('\n').trim();
      bufferLines = [];
      if (!joined) return;

      if (joined.length > targetChars) {
        const sentences = joined.split(/(?<=[.!?।;])\s+|\n+/);
        let seg = '';
        for (const s of sentences) {
          if (seg.length + s.length + 1 > targetChars && seg.trim().length > 0) {
            units.push({ page: p.page, heading: currentHeading, text: seg.trim() });
            seg = s;
          } else {
            seg = seg ? `${seg} ${s}` : s;
          }
        }
        if (seg.trim().length > 0) {
          units.push({ page: p.page, heading: currentHeading, text: seg.trim() });
        }
      } else {
        units.push({ page: p.page, heading: currentHeading, text: joined });
      }
    };

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        continue;
      }
      const detected = detectHeadingLine(trimmed);
      if (detected) {
        flushParagraph();
        currentHeading = detected;
        bufferLines.push(trimmed);
        flushParagraph();
      } else {
        bufferLines.push(trimmed);
        if (bufferLines.join('\n').length >= 700) {
          flushParagraph();
        }
      }
    }
    flushParagraph();
  }

  if (units.length === 0) return [];

  const chunks: DocumentChunk[] = [];
  let accUnits: ParagraphUnit[] = [];
  let accChars = 0;

  const finalizeChunk = (chunkUnits: ParagraphUnit[]) => {
    if (chunkUnits.length === 0) return;
    const content = chunkUnits.map((u) => u.text).join('\n\n').trim();
    if (!content) return;

    const pageFrom = chunkUnits[0].page;
    const pageTo = chunkUnits[chunkUnits.length - 1].page;
    // Lấy heading của phần nội dung chính (ưu tiên đoạn mới nhất trong chunk)
    let heading: string | null = null;
    for (let i = chunkUnits.length - 1; i >= 0; i--) {
      if (chunkUnits[i].heading) {
        heading = chunkUnits[i].heading;
        break;
      }
    }

    const pageLabel = pageTo > pageFrom ? `tr.${pageFrom}-${pageTo}` : `tr.${pageFrom}`;
    const prefix = heading
      ? `[${displayFile} – Mục: ${heading} – ${pageLabel}]`
      : `[${displayFile} – ${pageLabel}]`;
    const embedInput = `${prefix}\n${content}`;

    chunks.push({
      chunkIndex: chunks.length,
      heading,
      pageFrom,
      pageTo,
      content,
      embedInput,
      tokenCount: estimateTokenCount(content),
    });
  };

  for (const unit of units) {
    const firstPageInAcc = accUnits.length > 0 ? accUnits[0].page : unit.page;
    const pageSpan = unit.page - firstPageInAcc + 1;
    const exceedsChars = accChars + unit.text.length > targetChars;
    const exceedsPageSpan = pageSpan > maxPagesPerChunk && accChars >= 220;

    if ((exceedsChars || exceedsPageSpan) && accUnits.length > 0) {
      finalizeChunk(accUnits);

      // Giữ lại các đoạn cuối làm phần chồng lấn (overlap) nếu cùng tiêu đề chương/mục
      const overlapUnits: ParagraphUnit[] = [];
      let ovChars = 0;
      for (let i = accUnits.length - 1; i >= 0; i--) {
        const candidate = accUnits[i];
        if (unit.heading && candidate.heading && unit.heading !== candidate.heading) {
          break;
        }
        if (unit.page - candidate.page >= maxPagesPerChunk) {
          break;
        }
        if (ovChars + candidate.text.length > overlapChars && overlapUnits.length > 0) {
          break;
        }
        overlapUnits.unshift(candidate);
        ovChars += candidate.text.length;
        if (ovChars >= overlapChars) break;
      }

      accUnits = [...overlapUnits, unit];
      accChars = ovChars + unit.text.length;
    } else {
      accUnits.push(unit);
      accChars += unit.text.length;
    }
  }

  if (accUnits.length > 0) {
    const lastContent = accUnits.map((u) => u.text).join('\n\n').trim();
    const prevContent = chunks.length > 0 ? chunks[chunks.length - 1].content : '';
    if (!prevContent || !prevContent.includes(lastContent)) {
      finalizeChunk(accUnits);
    }
  }

  return chunks;
}
