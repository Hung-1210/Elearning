// src/services/ai/text-extract.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ExtractedPage {
  page: number;
  text: string;
}

export interface ExtractionResult {
  status: 'ok' | 'unsupported' | 'scanned_pdf' | 'too_large' | 'parse_error';
  errorCode?: 'scanned_pdf' | 'too_large' | 'parse_error' | 'unsupported';
  errorMessage?: string;
  pages: ExtractedPage[];
  pageCount: number;
  charCount: number;
}

export const SUPPORTED_DOC_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.pptx',
  '.txt',
  '.md',
  '.csv',
  '.json',
]);

export const MAX_DOC_PAGES = 300;
export const MAX_DOC_CHARS = 1_500_000;

export function isSupportedDocExtension(fileNameOrPath: string): boolean {
  const ext = path.extname(fileNameOrPath).toLowerCase();
  return SUPPORTED_DOC_EXTENSIONS.has(ext);
}

/** Trích xuất văn bản theo từng trang từ file tài liệu trên đĩa hoặc Buffer. */
export async function extractDocumentPages(
  filePathOrBuffer: string | Buffer,
  fileNameHint?: string,
): Promise<ExtractionResult> {
  const ext = path
    .extname(fileNameHint || (typeof filePathOrBuffer === 'string' ? filePathOrBuffer : ''))
    .toLowerCase();

  if (!SUPPORTED_DOC_EXTENSIONS.has(ext)) {
    return {
      status: 'unsupported',
      errorCode: 'unsupported',
      errorMessage: `Định dạng tệp "${ext || 'không xác định'}" chưa hỗ trợ trích xuất văn bản cho AI (hỗ trợ PDF, DOCX, PPTX, TXT, MD).`,
      pages: [],
      pageCount: 0,
      charCount: 0,
    };
  }

  let buffer: Buffer;
  try {
    buffer =
      typeof filePathOrBuffer === 'string'
        ? await fs.promises.readFile(filePathOrBuffer)
        : filePathOrBuffer;
  } catch (err: any) {
    return {
      status: 'parse_error',
      errorCode: 'parse_error',
      errorMessage: `Không thể đọc tệp tài liệu: ${err?.message || 'Tệp không tồn tại'}`,
      pages: [],
      pageCount: 0,
      charCount: 0,
    };
  }

  try {
    let pages: ExtractedPage[] = [];
    if (ext === '.txt' || ext === '.md' || ext === '.csv' || ext === '.json') {
      pages = extractPlainTextPages(buffer);
    } else if (ext === '.docx') {
      pages = extractDocxPages(buffer);
    } else if (ext === '.pptx') {
      pages = extractPptxPages(buffer);
    } else if (ext === '.pdf') {
      pages = extractPdfPages(buffer);
    }

    const pageCount = pages.length;
    const charCount = pages.reduce((acc, p) => acc + p.text.trim().length, 0);

    if (pageCount > MAX_DOC_PAGES || charCount > MAX_DOC_CHARS) {
      return {
        status: 'too_large',
        errorCode: 'too_large',
        errorMessage: `Tài liệu vượt quá giới hạn xử lý (${pageCount} trang, ${charCount.toLocaleString('vi-VN')} ký tự; tối đa ${MAX_DOC_PAGES} trang hoặc 1,5 triệu ký tự).`,
        pages: [],
        pageCount,
        charCount,
      };
    }

    if (ext === '.pdf') {
      const minExpectedChars = Math.max(20, Math.min(200, Math.floor((pageCount / 10) * 200)));
      if (charCount < minExpectedChars) {
        return {
          status: 'scanned_pdf',
          errorCode: 'scanned_pdf',
          errorMessage:
            'Tài liệu là ảnh scan, chưa hỗ trợ hỏi đáp. Hãy tải bản PDF có thể bôi đen chữ.',
          pages: [],
          pageCount: Math.max(1, pageCount),
          charCount,
        };
      }
    } else if (charCount < 10) {
      return {
        status: 'parse_error',
        errorCode: 'parse_error',
        errorMessage: 'Tài liệu không có nội dung văn bản để lập chỉ mục.',
        pages: [],
        pageCount,
        charCount,
      };
    }

    return {
      status: 'ok',
      pages: pages.filter((p) => p.text.trim().length > 0),
      pageCount: Math.max(1, pageCount),
      charCount,
    };
  } catch (err: any) {
    return {
      status: 'parse_error',
      errorCode: 'parse_error',
      errorMessage: `Lỗi khi trích xuất văn bản: ${err?.message || 'Định dạng tệp bị hỏng'}`,
      pages: [],
      pageCount: 0,
      charCount: 0,
    };
  }
}

// ===========================================================================
// 1. TXT / MD / CSV / JSON
// ===========================================================================
function extractPlainTextPages(buffer: Buffer): ExtractedPage[] {
  const raw = buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const PAGE_CHARS = 2800;
  const paragraphs = trimmed.split(/\n{2,}/);
  const pages: ExtractedPage[] = [];
  let current = '';
  let pageNo = 1;

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > PAGE_CHARS && current.trim().length > 0) {
      pages.push({ page: pageNo++, text: current.trim() });
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim().length > 0) {
    pages.push({ page: pageNo, text: current.trim() });
  }
  return pages;
}

// ===========================================================================
// 2. ZIP READER NHẸ CHO DOCX & PPTX (DÙNG node:zlib, KHÔNG CẦN THƯ VIỆN NGOÀI)
// ===========================================================================
function readZipEntries(zipBuf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  // Tìm End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, zipBuf.length - 65557);
  for (let i = zipBuf.length - 22; i >= minEocdSearch; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Không phải định dạng nén ZIP/Office hợp lệ');
  }

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  let ptr = cdOffset;
  for (let idx = 0; idx < totalEntries && ptr + 46 <= zipBuf.length; idx++) {
    const sig = zipBuf.readUInt32LE(ptr);
    if (sig !== 0x02014b50) break;

    const compressionMethod = zipBuf.readUInt16LE(ptr + 10);
    const compressedSize = zipBuf.readUInt32LE(ptr + 20);
    const fileNameLen = zipBuf.readUInt16LE(ptr + 28);
    const extraLen = zipBuf.readUInt16LE(ptr + 30);
    const commentLen = zipBuf.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(ptr + 42);

    const fileName = zipBuf.subarray(ptr + 46, ptr + 46 + fileNameLen).toString('utf8');
    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (fileName.endsWith('/') || localHeaderOffset + 30 > zipBuf.length) continue;
    if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuf.length) continue;

    const rawSlice = zipBuf.subarray(dataStart, dataEnd);
    if (compressionMethod === 0) {
      entries.set(fileName, rawSlice);
    } else if (compressionMethod === 8) {
      try {
        entries.set(fileName, zlib.inflateRawSync(rawSlice));
      } catch {
        // Bỏ qua entry lỗi
      }
    }
  }

  return entries;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function extractDocxPages(buffer: Buffer): ExtractedPage[] {
  const entries = readZipEntries(buffer);
  const docXmlBuf = entries.get('word/document.xml');
  if (!docXmlBuf) {
    throw new Error('Không tìm thấy word/document.xml trong tệp DOCX');
  }
  const xml = docXmlBuf.toString('utf8');
  const pages: ExtractedPage[] = [];
  let currentLines: string[] = [];
  let currentChars = 0;
  let pageNo = 1;

  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pInner = pMatch[1];
    const hasPageBreak =
      /<w:lastRenderedPageBreak\s*\/>|<w:br\b[^>]*w:type="page"/.test(pInner);

    const styleMatch = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(pInner);
    const isHeading = styleMatch && /^(Heading|Title|Subtitle|Chuong|Muc)/i.test(styleMatch[1]);

    const tRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
    let tMatch: RegExpExecArray | null;
    let line = '';
    while ((tMatch = tRegex.exec(pInner)) !== null) {
      if (tMatch[0].startsWith('<w:tab')) line += '\t';
      else if (tMatch[0].startsWith('<w:br')) line += '\n';
      else if (tMatch[1] !== undefined) line += decodeXmlEntities(tMatch[1]);
    }

    const cleanLine = line.trim();
    if (hasPageBreak && currentLines.length > 0) {
      pages.push({ page: pageNo++, text: currentLines.join('\n\n') });
      currentLines = [];
      currentChars = 0;
    }

    if (cleanLine) {
      const formatted = isHeading ? `## ${cleanLine}` : cleanLine;
      currentLines.push(formatted);
      currentChars += formatted.length;
      if (currentChars >= 2800) {
        pages.push({ page: pageNo++, text: currentLines.join('\n\n') });
        currentLines = [];
        currentChars = 0;
      }
    }
  }

  if (currentLines.length > 0) {
    pages.push({ page: pageNo, text: currentLines.join('\n\n') });
  }
  return pages;
}

function extractPptxPages(buffer: Buffer): ExtractedPage[] {
  const entries = readZipEntries(buffer);
  const slideEntries: Array<{ slideNo: number; xml: string }> = [];

  for (const [name, buf] of entries.entries()) {
    const m = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(name);
    if (m) {
      slideEntries.push({ slideNo: parseInt(m[1], 10), xml: buf.toString('utf8') });
    }
  }

  slideEntries.sort((a, b) => a.slideNo - b.slideNo);
  const pages: ExtractedPage[] = [];

  for (const slide of slideEntries) {
    const paragraphs: string[] = [];
    const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = pRegex.exec(slide.xml)) !== null) {
      const pInner = pMatch[1];
      const tRegex = /<a:t(?:\s+[^>]*)?>([\s\S]*?)<\/a:t>/g;
      let tMatch: RegExpExecArray | null;
      let line = '';
      while ((tMatch = tRegex.exec(pInner)) !== null) {
        line += decodeXmlEntities(tMatch[1]);
      }
      if (line.trim()) {
        paragraphs.push(line.trim());
      }
    }
    if (paragraphs.length > 0) {
      pages.push({
        page: slide.slideNo,
        text: paragraphs.join('\n'),
      });
    }
  }
  return pages;
}

// ===========================================================================
// 3. PDF PARSER (HỖ TRỢ /ObjStm, /FlateDecode, PNG Predictor, /ToUnicode CMap)
// ===========================================================================
interface PdfObject {
  id: number;
  dictText: string;
  stream?: Buffer;
  decodedStream?: Buffer;
}

function inflatePdfStream(raw: Buffer, dictText: string): Buffer {
  let inflated: Buffer | null = null;
  try {
    inflated = zlib.inflateSync(raw);
  } catch {
    try {
      inflated = zlib.inflateRawSync(raw);
    } catch {
      return raw;
    }
  }

  const predMatch = /\/Predictor\s+(\d+)/.exec(dictText);
  const predictor = predMatch ? parseInt(predMatch[1], 10) : 1;
  if (predictor >= 10) {
    const colMatch = /\/Columns\s+(\d+)/.exec(dictText);
    const cols = colMatch ? parseInt(colMatch[1], 10) : 1;
    const rowBytes = cols + 1;
    if (cols > 0 && inflated.length >= rowBytes) {
      const rows = Math.floor(inflated.length / rowBytes);
      const out = Buffer.alloc(rows * cols);
      const prevRow = Buffer.alloc(cols, 0);
      for (let r = 0; r < rows; r++) {
        const filterType = inflated[r * rowBytes];
        for (let c = 0; c < cols; c++) {
          const rawByte = inflated[r * rowBytes + 1 + c];
          let recon = rawByte;
          if (filterType === 1) {
            const left = c > 0 ? out[r * cols + c - 1] : 0;
            recon = (rawByte + left) & 0xff;
          } else if (filterType === 2) {
            recon = (rawByte + prevRow[c]) & 0xff;
          }
          out[r * cols + c] = recon;
          prevRow[c] = recon;
        }
      }
      return out;
    }
  }
  return inflated;
}

function getDecodedStream(obj: PdfObject): Buffer | null {
  if (!obj.stream) return null;
  if (obj.decodedStream) return obj.decodedStream;
  if (/\/FlateDecode\b|\/Fl\b/.test(obj.dictText)) {
    obj.decodedStream = inflatePdfStream(obj.stream, obj.dictText);
  } else {
    obj.decodedStream = obj.stream;
  }
  return obj.decodedStream;
}

function parseTopLevelPdfObjects(buf: Buffer): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const latin = buf.toString('latin1');
  const objHeaderRegex = /(?:^|[\r\n\s])(\d+)\s+\d+\s+obj\b/g;

  let match: RegExpExecArray | null;
  while ((match = objHeaderRegex.exec(latin)) !== null) {
    const id = parseInt(match[1], 10);
    const bodyStart = match.index + match[0].length;
    const endObjIdx = latin.indexOf('endobj', bodyStart);
    if (endObjIdx < 0) continue;

    const streamTagIdx = latin.indexOf('stream', bodyStart);
    if (streamTagIdx >= 0 && streamTagIdx < endObjIdx) {
      // Kiểm tra chữ 'stream' không phải là '/Subtype /ObjStm' hay tên biến
      const beforeChar = latin[streamTagIdx - 1] || ' ';
      const afterChar = latin[streamTagIdx + 6] || '';
      if (!/[A-Za-z0-9/]/.test(beforeChar) && (afterChar === '\r' || afterChar === '\n')) {
        const dictText = latin.slice(bodyStart, streamTagIdx).trim();
        let dataStart = streamTagIdx + 6;
        if (latin[dataStart] === '\r' && latin[dataStart + 1] === '\n') dataStart += 2;
        else if (latin[dataStart] === '\n' || latin[dataStart] === '\r') dataStart += 1;

        let endStreamIdx = latin.lastIndexOf('endstream', endObjIdx);
        if (endStreamIdx < dataStart) {
          endStreamIdx = endObjIdx;
        }
        let dataEnd = endStreamIdx;
        if (latin[dataEnd - 2] === '\r' && latin[dataEnd - 1] === '\n') dataEnd -= 2;
        else if (latin[dataEnd - 1] === '\n' || latin[dataEnd - 1] === '\r') dataEnd -= 1;

        objects.set(id, {
          id,
          dictText,
          stream: buf.subarray(dataStart, Math.max(dataStart, dataEnd)),
        });
        continue;
      }
    }

    const dictText = latin.slice(bodyStart, endObjIdx).trim();
    objects.set(id, { id, dictText });
  }

  // Giải nén các Object Stream (/Type /ObjStm) của PDF 1.5+
  for (const obj of Array.from(objects.values())) {
    if (!/\/Type\s*\/ObjStm\b/.test(obj.dictText)) continue;
    const nMatch = /\/N\s+(\d+)/.exec(obj.dictText);
    const firstMatch = /\/First\s+(\d+)/.exec(obj.dictText);
    if (!nMatch || !firstMatch) continue;

    const n = parseInt(nMatch[1], 10);
    const firstOffset = parseInt(firstMatch[1], 10);
    const decoded = getDecodedStream(obj);
    if (!decoded || firstOffset > decoded.length) continue;

    const headerStr = decoded.subarray(0, firstOffset).toString('latin1').trim();
    const tokens = headerStr.split(/\s+/).map((t) => parseInt(t, 10));
    const pairs: Array<{ id: number; offset: number }> = [];
    for (let i = 0; i + 1 < tokens.length && pairs.length < n; i += 2) {
      if (Number.isFinite(tokens[i]) && Number.isFinite(tokens[i + 1])) {
        pairs.push({ id: tokens[i], offset: firstOffset + tokens[i + 1] });
      }
    }

    for (let i = 0; i < pairs.length; i++) {
      const start = pairs[i].offset;
      const end = i + 1 < pairs.length ? pairs[i + 1].offset : decoded.length;
      if (start >= 0 && end >= start && end <= decoded.length) {
        const innerText = decoded.subarray(start, end).toString('latin1').trim();
        if (!objects.has(pairs[i].id)) {
          objects.set(pairs[i].id, { id: pairs[i].id, dictText: innerText });
        }
      }
    }
  }

  return objects;
}

interface CMapTable {
  map: Map<number, string>;
  keyByteLengths: number[];
}

function hexToUnicodeString(hex: string): string {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  if (!clean) return '';
  if (clean.length <= 2) {
    return String.fromCodePoint(parseInt(clean, 16));
  }
  const padded = clean.length % 4 === 0 ? clean : clean.padStart(Math.ceil(clean.length / 4) * 4, '0');
  const codeUnits: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    codeUnits.push(parseInt(padded.slice(i, i + 4), 16));
  }
  return String.fromCharCode(...codeUnits);
}

function parseToUnicodeCMap(cmapText: string): CMapTable {
  const map = new Map<number, string>();
  const lengthsSet = new Set<number>();

  // 1. beginbfchar ... endbfchar
  const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let match: RegExpExecArray | null;
  while ((match = bfcharRegex.exec(cmapText)) !== null) {
    const body = match[1];
    const pairRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p: RegExpExecArray | null;
    while ((p = pairRegex.exec(body)) !== null) {
      const srcHex = p[1];
      const dstHex = p[2];
      const code = parseInt(srcHex, 16);
      lengthsSet.add(Math.max(1, Math.ceil(srcHex.length / 2)));
      map.set(code, hexToUnicodeString(dstHex));
    }
  }

  // 2. beginbfrange ... endbfrange
  const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((match = bfrangeRegex.exec(cmapText)) !== null) {
    const body = match[1];

    // Dạng 2 (Xử lý trước): <start> <end> [ <dst1> <dst2> ... ]
    const arrayRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    let r: RegExpExecArray | null;
    while ((r = arrayRegex.exec(body)) !== null) {
      const startCode = parseInt(r[1], 16);
      lengthsSet.add(Math.max(1, Math.ceil(r[1].length / 2)));
      const items = Array.from(r[3].matchAll(/<([0-9A-Fa-f]+)>/g)).map((m) => m[1]);
      for (let idx = 0; idx < items.length; idx++) {
        map.set(startCode + idx, hexToUnicodeString(items[idx]));
      }
    }

    // Xóa toàn bộ các dòng dạng mảng [...] trước khi tìm dạng trực tiếp <start> <end> <dstStart>
    // để tránh khớp nhầm 3 phần tử liên tiếp bên trong mảng [...]!
    const bodyWithoutArrays = body.replace(
      /<[0-9A-Fa-f]+>\s*<[0-9A-Fa-f]+>\s*\[[\s\S]*?\]/g,
      '',
    );

    // Dạng 1: <start> <end> <dstStart>
    const directRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    while ((r = directRegex.exec(bodyWithoutArrays)) !== null) {
      const startCode = parseInt(r[1], 16);
      const endCode = parseInt(r[2], 16);
      lengthsSet.add(Math.max(1, Math.ceil(r[1].length / 2)));
      const baseUnicode = hexToUnicodeString(r[3]);
      if (!baseUnicode) continue;
      const firstCp = baseUnicode.codePointAt(0) ?? 0;
      const span = Math.min(2048, Math.max(0, endCode - startCode));
      for (let offset = 0; offset <= span; offset++) {
        map.set(startCode + offset, String.fromCodePoint(firstCp + offset));
      }
    }
  }

  const keyByteLengths = Array.from(lengthsSet).sort((a, b) => b - a);
  if (keyByteLengths.length === 0) keyByteLengths.push(2, 1);
  return { map, keyByteLengths };
}

function unescapePdfLiteralBytes(raw: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      bytes.push(raw.charCodeAt(i) & 0xff);
      continue;
    }
    i++;
    if (i >= raw.length) break;
    const next = raw[i];
    if (next === 'n') bytes.push(10);
    else if (next === 'r') bytes.push(13);
    else if (next === 't') bytes.push(9);
    else if (next === 'b') bytes.push(8);
    else if (next === 'f') bytes.push(12);
    else if (next === '(' || next === ')' || next === '\\') bytes.push(next.charCodeAt(0));
    else if (next === '\r') {
      if (raw[i + 1] === '\n') i++;
    } else if (next === '\n') {
      // line continuation
    } else if (next >= '0' && next <= '7') {
      let oct = next;
      if (raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
      if (raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else {
      bytes.push(next.charCodeAt(0) & 0xff);
    }
  }
  return bytes;
}

function hexTokenToBytes(hex: string): number[] {
  const clean = hex.replace(/\s+/g, '');
  const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 2) {
    const val = parseInt(padded.slice(i, i + 2), 16);
    if (Number.isFinite(val)) bytes.push(val);
  }
  return bytes;
}

function decodePdfBytesWithCMap(bytes: number[], cmap?: CMapTable): string {
  if (bytes.length === 0) return '';

  // UTF-16BE BOM
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const units: number[] = [];
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      units.push((bytes[i] << 8) | bytes[i + 1]);
    }
    return String.fromCharCode(...units);
  }

  if (cmap && cmap.map.size > 0) {
    let out = '';
    const prefer2Byte = cmap.keyByteLengths.includes(2) && !cmap.keyByteLengths.includes(1);
    let i = 0;
    while (i < bytes.length) {
      if (prefer2Byte && i + 1 < bytes.length) {
        const code2 = (bytes[i] << 8) | bytes[i + 1];
        const mapped2 = cmap.map.get(code2);
        if (mapped2 !== undefined) {
          out += mapped2;
          i += 2;
          continue;
        }
      }
      let matched = false;
      for (const byteLen of cmap.keyByteLengths) {
        if (i + byteLen <= bytes.length) {
          let code = 0;
          for (let b = 0; b < byteLen; b++) {
            code = (code << 8) | bytes[i + b];
          }
          const mapped = cmap.map.get(code);
          if (mapped !== undefined) {
            out += mapped;
            i += byteLen;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        const b = bytes[i++];
        if (b >= 32 && b <= 126) {
          out += String.fromCharCode(b);
        } else if (b >= 160) {
          out += String.fromCharCode(b);
        }
      }
    }
    return out;
  }

  return Buffer.from(bytes).toString('latin1');
}

function buildFontCMapDictionary(
  pageDict: string,
  parentDicts: string[],
  objects: Map<number, PdfObject>,
  globalCMapsByObjId: Map<number, CMapTable>,
): Map<string, CMapTable | null> {
  const fontMap = new Map<string, CMapTable | null>();
  const dictsToSearch = [pageDict, ...parentDicts];

  for (const dict of dictsToSearch) {
    // Tìm /Resources X 0 R nếu /Resources là indirect object
    let searchSource = dict;
    const resRefMatch = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(dict);
    if (resRefMatch) {
      const resObj = objects.get(parseInt(resRefMatch[1], 10));
      if (resObj) searchSource = `${dict}\n${resObj.dictText}`;
    }

    // Tìm /Font << ... >> hoặc /Font X 0 R
    const fontRefMatch = /\/Font\s+(\d+)\s+\d+\s+R/.exec(searchSource);
    let fontBlock = searchSource;
    if (fontRefMatch) {
      const refObj = objects.get(parseInt(fontRefMatch[1], 10));
      if (refObj) fontBlock = refObj.dictText;
    } else {
      const inlineFontMatch = /\/Font\s*<<([\s\S]*?)>>/.exec(searchSource);
      if (inlineFontMatch) fontBlock = inlineFontMatch[1];
    }

    const entryRegex = /\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g;
    let m: RegExpExecArray | null;
    while ((m = entryRegex.exec(fontBlock)) !== null) {
      const fontName = m[1];
      const fontObjId = parseInt(m[2], 10);
      if (fontMap.has(fontName)) continue;

      const fontObj = objects.get(fontObjId);
      if (!fontObj) continue;

      let toUniMatch = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fontObj.dictText);
      if (!toUniMatch) {
        // Kiểm tra DescendantFonts nếu là Type0
        const descMatch = /\/DescendantFonts\s*\[\s*(\d+)\s+\d+\s+R/.exec(fontObj.dictText);
        if (descMatch) {
          const descObj = objects.get(parseInt(descMatch[1], 10));
          if (descObj) {
            toUniMatch = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(descObj.dictText);
          }
        }
      }
      if (toUniMatch) {
        const cmapObjId = parseInt(toUniMatch[1], 10);
        const cmap = globalCMapsByObjId.get(cmapObjId);
        fontMap.set(fontName, cmap ?? null);
      } else {
        // Font 1-byte chuẩn (WinAnsiEncoding / MacRomanEncoding) không có ToUnicode CMap
        fontMap.set(fontName, null);
      }
    }
  }

  return fontMap;
}

function extractTextFromContentStream(
  contentLatin: string,
  fontCMaps: Map<string, CMapTable | null>,
  fallbackCMap?: CMapTable,
): string {
  const lines: string[] = [];
  let currentLine = '';
  let activeFontName = '';
  let lastY: number | null = null;

  const pushCurrentLine = () => {
    const cleaned = currentLine.replace(/[ \t]+/g, ' ').trim();
    if (cleaned) lines.push(cleaned);
    currentLine = '';
  };

  // Duyệt từng khối BT ... ET (hoặc toàn bộ stream nếu PDF không đóng ET chuẩn)
  const btBlocks: string[] = [];
  const btRegex = /\bBT\b([\s\S]*?)(?:\bET\b|$)/g;
  let btMatch: RegExpExecArray | null;
  while ((btMatch = btRegex.exec(contentLatin)) !== null) {
    btBlocks.push(btMatch[1]);
  }
  if (btBlocks.length === 0) {
    btBlocks.push(contentLatin);
  }

  for (const block of btBlocks) {
    let idx = 0;
    const len = block.length;
    const tokenStack: string[] = [];

    const skipWsAndComments = () => {
      while (idx < len) {
        const c = block[idx];
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\0') {
          idx++;
        } else if (c === '%') {
          while (idx < len && block[idx] !== '\n' && block[idx] !== '\r') idx++;
        } else {
          break;
        }
      }
    };

    const readLiteralString = (): string => {
      idx++; // skip '('
      let depth = 1;
      let out = '';
      while (idx < len && depth > 0) {
        const c = block[idx++];
        if (c === '\\') {
          out += c;
          if (idx < len) out += block[idx++];
        } else if (c === '(') {
          depth++;
          out += c;
        } else if (c === ')') {
          depth--;
          if (depth > 0) out += c;
        } else {
          out += c;
        }
      }
      return out;
    };

    const readHexString = (): string => {
      idx++; // skip '<'
      let out = '';
      while (idx < len && block[idx] !== '>') {
        out += block[idx++];
      }
      if (idx < len && block[idx] === '>') idx++;
      return out;
    };

    const getActiveCMap = (): CMapTable | undefined => {
      if (activeFontName && fontCMaps.has(activeFontName)) {
        return fontCMaps.get(activeFontName) ?? undefined;
      }
      return fallbackCMap;
    };

    while (idx < len) {
      skipWsAndComments();
      if (idx >= len) break;

      const ch = block[idx];

      if (ch === '(') {
        const lit = readLiteralString();
        tokenStack.push(`L:${lit}`);
      } else if (ch === '<' && block[idx + 1] !== '<') {
        const hex = readHexString();
        tokenStack.push(`H:${hex}`);
      } else if (ch === '<' && block[idx + 1] === '<') {
        idx += 2;
      } else if (ch === '>' && block[idx + 1] === '>') {
        idx += 2;
      } else if (ch === '[') {
        idx++;
        const arrItems: string[] = [];
        while (idx < len) {
          skipWsAndComments();
          if (idx >= len) break;
          if (block[idx] === ']') {
            idx++;
            break;
          }
          if (block[idx] === '(') {
            arrItems.push(`L:${readLiteralString()}`);
          } else if (block[idx] === '<' && block[idx + 1] !== '<') {
            arrItems.push(`H:${readHexString()}`);
          } else {
            let numTok = '';
            while (idx < len && !/[\s()<>[\]/%]/.test(block[idx])) {
              numTok += block[idx++];
            }
            if (numTok) arrItems.push(`N:${numTok}`);
          }
        }
        tokenStack.push(`A:${JSON.stringify(arrItems)}`);
      } else if (ch === '/') {
        idx++;
        let name = '';
        while (idx < len && !/[\s()<>[\]/%]/.test(block[idx])) {
          name += block[idx++];
        }
        tokenStack.push(`/${name}`);
      } else {
        let word = '';
        while (idx < len && !/[\s()<>[\]/%]/.test(block[idx])) {
          word += block[idx++];
        }
        if (!word) {
          idx++;
          continue;
        }

        if (word === 'Tf') {
          const _size = tokenStack.pop();
          const fontTok = tokenStack.pop();
          if (fontTok && fontTok.startsWith('/')) {
            activeFontName = fontTok.slice(1);
          }
          tokenStack.length = 0;
        } else if (word === 'Td' || word === 'TD') {
          const ty = parseFloat(tokenStack.pop() || '0');
          const tx = parseFloat(tokenStack.pop() || '0');
          if (Math.abs(ty) > 1.5) {
            pushCurrentLine();
            if (lastY !== null) lastY += ty;
          } else if (tx > 1 && currentLine && !currentLine.endsWith(' ')) {
            currentLine += ' ';
          }
          tokenStack.length = 0;
        } else if (word === 'Tm') {
          const y = parseFloat(tokenStack.pop() || '0');
          const _x = parseFloat(tokenStack.pop() || '0');
          if (lastY !== null && Math.abs(y - lastY) > 3.5) {
            pushCurrentLine();
          } else if (currentLine && !currentLine.endsWith(' ')) {
            currentLine += ' ';
          }
          lastY = y;
          tokenStack.length = 0;
        } else if (word === 'T*') {
          pushCurrentLine();
          tokenStack.length = 0;
        } else if (word === 'Tj' || word === "'" || word === '"') {
          if (word === "'" || word === '"') pushCurrentLine();
          const strTok = tokenStack.pop();
          if (strTok) {
            const cmap = getActiveCMap();
            if (strTok.startsWith('L:')) {
              currentLine += decodePdfBytesWithCMap(
                unescapePdfLiteralBytes(strTok.slice(2)),
                cmap,
              );
            } else if (strTok.startsWith('H:')) {
              currentLine += decodePdfBytesWithCMap(hexTokenToBytes(strTok.slice(2)), cmap);
            }
          }
          tokenStack.length = 0;
        } else if (word === 'TJ') {
          const arrTok = tokenStack.pop();
          if (arrTok && arrTok.startsWith('A:')) {
            const cmap = getActiveCMap();
            const items: string[] = JSON.parse(arrTok.slice(2));
            for (const item of items) {
              if (item.startsWith('L:')) {
                currentLine += decodePdfBytesWithCMap(
                  unescapePdfLiteralBytes(item.slice(2)),
                  cmap,
                );
              } else if (item.startsWith('H:')) {
                currentLine += decodePdfBytesWithCMap(hexTokenToBytes(item.slice(2)), cmap);
              } else if (item.startsWith('N:')) {
                const kern = parseFloat(item.slice(2));
                if (kern < -120 && currentLine && !currentLine.endsWith(' ')) {
                  currentLine += ' ';
                }
              }
            }
          }
          tokenStack.length = 0;
        } else if (/^-?\d+(\.\d+)?$/.test(word)) {
          tokenStack.push(word);
        } else {
          tokenStack.length = 0;
        }
      }
    }
    if (currentLine && !currentLine.endsWith(' ')) {
      currentLine += ' ';
    }
  }
  pushCurrentLine();

  return lines.join('\n');
}

function extractPdfPages(buffer: Buffer): ExtractedPage[] {
  const objects = parseTopLevelPdfObjects(buffer);

  // 1. Parse tất cả các stream CMap (chứa beginbfchar hoặc beginbfrange)
  const globalCMapsByObjId = new Map<number, CMapTable>();
  let mergedFallbackCMap: CMapTable | undefined;

  for (const obj of objects.values()) {
    const decoded = getDecodedStream(obj);
    if (!decoded) continue;
    const text = decoded.toString('latin1');
    if (text.includes('beginbfchar') || text.includes('beginbfrange')) {
      const cmap = parseToUnicodeCMap(text);
      if (cmap.map.size > 0) {
        globalCMapsByObjId.set(obj.id, cmap);
        if (!mergedFallbackCMap) {
          mergedFallbackCMap = {
            map: new Map(cmap.map),
            keyByteLengths: [...cmap.keyByteLengths],
          };
        } else {
          for (const [k, v] of cmap.map.entries()) {
            if (!mergedFallbackCMap.map.has(k)) mergedFallbackCMap.map.set(k, v);
          }
        }
      }
    }
  }

  // 2. Tìm tất cả các đối tượng /Type /Page (không phải /Pages)
  const pageObjects: PdfObject[] = [];
  for (const obj of objects.values()) {
    if (/\/Type\s*\/Page\b(?!s)/.test(obj.dictText)) {
      pageObjects.push(obj);
    }
  }

  // Sắp xếp theo thứ tự trong cây /Pages nếu có /Kids, nếu không thì theo ID
  const orderedPages = sortPdfPageObjects(pageObjects, objects);

  const pages: ExtractedPage[] = [];
  let pageNo = 1;

  for (const pageObj of orderedPages) {
    const parentDicts: string[] = [];
    let curDict = pageObj.dictText;
    for (let depth = 0; depth < 5; depth++) {
      const pMatch = /\/Parent\s+(\d+)\s+\d+\s+R/.exec(curDict);
      if (!pMatch) break;
      const parentObj = objects.get(parseInt(pMatch[1], 10));
      if (!parentObj) break;
      parentDicts.push(parentObj.dictText);
      curDict = parentObj.dictText;
    }

    const fontCMaps = buildFontCMapDictionary(
      pageObj.dictText,
      parentDicts,
      objects,
      globalCMapsByObjId,
    );

    const contentStreamIds: number[] = [];
    const arrayContentsMatch = /\/Contents\s*\[([\s\S]*?)\]/.exec(pageObj.dictText);
    if (arrayContentsMatch) {
      const refs = arrayContentsMatch[1].matchAll(/(\d+)\s+\d+\s+R/g);
      for (const r of refs) contentStreamIds.push(parseInt(r[1], 10));
    } else {
      const singleContentMatch = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pageObj.dictText);
      if (singleContentMatch) {
        contentStreamIds.push(parseInt(singleContentMatch[1], 10));
      }
    }

    const combinedStreams: string[] = [];
    for (const cid of contentStreamIds) {
      const cObj = objects.get(cid);
      if (!cObj) continue;
      const dec = getDecodedStream(cObj);
      if (dec) combinedStreams.push(dec.toString('latin1'));
    }

    const pageText = extractTextFromContentStream(
      combinedStreams.join('\n'),
      fontCMaps,
      mergedFallbackCMap,
    ).trim();

    pages.push({ page: pageNo++, text: pageText });
  }

  return pages;
}

function sortPdfPageObjects(
  pageObjects: PdfObject[],
  allObjects: Map<number, PdfObject>,
): PdfObject[] {
  // Tìm gốc /Type /Pages không có /Parent
  let rootPagesObj: PdfObject | undefined;
  for (const obj of allObjects.values()) {
    if (/\/Type\s*\/Pages\b/.test(obj.dictText) && !/\/Parent\b/.test(obj.dictText)) {
      rootPagesObj = obj;
      break;
    }
  }
  if (!rootPagesObj) {
    return pageObjects.sort((a, b) => a.id - b.id);
  }

  const ordered: PdfObject[] = [];
  const visited = new Set<number>();

  const walk = (obj: PdfObject) => {
    if (visited.has(obj.id)) return;
    visited.add(obj.id);
    if (/\/Type\s*\/Page\b(?!s)/.test(obj.dictText)) {
      ordered.push(obj);
      return;
    }
    const kidsMatch = /\/Kids\s*\[([\s\S]*?)\]/.exec(obj.dictText);
    if (!kidsMatch) return;
    const refs = kidsMatch[1].matchAll(/(\d+)\s+\d+\s+R/g);
    for (const r of refs) {
      const child = allObjects.get(parseInt(r[1], 10));
      if (child) walk(child);
    }
  };

  walk(rootPagesObj);
  if (ordered.length === pageObjects.length) return ordered;

  for (const p of pageObjects.sort((a, b) => a.id - b.id)) {
    if (!visited.has(p.id)) ordered.push(p);
  }
  return ordered;
}
