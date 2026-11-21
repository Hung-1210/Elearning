import React, { useState, useRef, useEffect } from 'react';
import type { RagCitation } from '../../../types';

const BACKEND_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001';

interface CitationChipProps {
  citation: RagCitation;
  active?: boolean;
}

export const CitationChip: React.FC<CitationChipProps> = ({ citation, active }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const pageLabel =
    citation.pageFrom && citation.pageTo && citation.pageTo > citation.pageFrom
      ? `tr.${citation.pageFrom}-${citation.pageTo}`
      : citation.pageFrom
        ? `tr.${citation.pageFrom}`
        : '';

  const isPdf = citation.fileName.toLowerCase().endsWith('.pdf');
  const fileUrl = `${BACKEND_URL}/uploads/${citation.fileName}${
    isPdf && citation.pageFrom ? `#page=${citation.pageFrom}` : ''
  }`;

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          borderRadius: 9999,
          fontSize: 12,
          fontWeight: 600,
          border: active || open ? '1px solid #4F46E5' : '1px solid #CBD5E1',
          background: active || open ? '#EEF2FF' : '#F8FAFC',
          color: active || open ? '#4338CA' : '#334155',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          maxWidth: 230,
        }}
        title={`${citation.displayFileName}${pageLabel ? ` · ${pageLabel}` : ''}`}
      >
        <span
          style={{
            background: '#4F46E5',
            color: '#FFFFFF',
            borderRadius: 9999,
            padding: '0 6px',
            fontSize: 11,
            fontWeight: 700,
            lineHeight: '16px',
            flexShrink: 0,
          }}
        >
          {citation.n}
        </span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {citation.displayFileName}
        </span>
        {pageLabel && (
          <span style={{ color: '#64748B', flexShrink: 0 }}>· {pageLabel}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            width: 310,
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            boxShadow: '0 10px 25px rgba(15, 23, 42, 0.14)',
            padding: 12,
            zIndex: 120,
            textAlign: 'left',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>
              [{citation.n}] {citation.displayFileName}
              {pageLabel ? ` (${pageLabel})` : ''}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#94A3B8',
                cursor: 'pointer',
                fontSize: 14,
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>

          {citation.heading && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#4F46E5',
                marginBottom: 6,
              }}
            >
              📑 {citation.heading}
            </div>
          )}

          <div
            style={{
              fontSize: 12,
              color: '#475569',
              background: '#F8FAFC',
              borderLeft: '3px solid #4F46E5',
              padding: '8px 10px',
              borderRadius: '0 8px 8px 0',
              maxHeight: 130,
              overflowY: 'auto',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              marginBottom: 10,
            }}
          >
            “{citation.snippet}…”
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                fontWeight: 600,
                color: '#4F46E5',
                textDecoration: 'none',
                padding: '4px 10px',
                borderRadius: 6,
                background: '#EEF2FF',
              }}
            >
              📄 Mở tài liệu {pageLabel ? `(${pageLabel})` : ''} ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

interface RagMarkdownRendererProps {
  content: string;
  citations?: RagCitation[];
  onCitationClick?: (n: number) => void;
}

/**
 * Bộ hiển thị Markdown + công thức toán học ($...$, $$...$$) + ký hiệu trích dẫn [1], [2]
 * gọn nhẹ, an toàn (không dùng dangerouslySetInnerHTML).
 */
export const RagMarkdownRenderer: React.FC<RagMarkdownRendererProps> = ({
  content,
  citations = [],
  onCitationClick,
}) => {
  const citationMap = new Map<number, RagCitation>();
  citations.forEach((c) => citationMap.set(c.n, c));

  // Tách khối code ```...``` hoặc công thức khối $$...$$
  const segments = content.split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$)/g);

  const renderInlineTokens = (line: string, keyPrefix: string) => {
    const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\$[^$\n]+\$|\[\d{1,2}\])/g;
    const parts = line.split(tokenRegex);

    return parts.map((part, idx) => {
      if (!part) return null;
      const key = `${keyPrefix}-${idx}`;

      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code
            key={key}
            style={{
              background: '#F1F5F9',
              color: '#0F172A',
              padding: '1px 5px',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: '0.9em',
            }}
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
        return (
          <span
            key={key}
            style={{
              fontFamily: ' Cambria Math, "Times New Roman", serif',
              fontStyle: 'italic',
              background: '#F8FAFC',
              padding: '0 4px',
              borderRadius: 4,
              color: '#1E293B',
            }}
          >
            {part.slice(1, -1)}
          </span>
        );
      }
      const citeMatch = /^\[(\d{1,2})\]$/.exec(part);
      if (citeMatch) {
        const num = parseInt(citeMatch[1], 10);
        const cite = citationMap.get(num);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onCitationClick?.(num)}
            title={
              cite
                ? `${cite.displayFileName}${cite.pageFrom ? ` (tr.${cite.pageFrom})` : ''}: ${cite.snippet.slice(0, 120)}...`
                : `Nguồn [${num}]`
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 2px',
              padding: '0 6px',
              height: 18,
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 9999,
              border: 'none',
              background: '#EEF2FF',
              color: '#4F46E5',
              cursor: 'pointer',
              verticalAlign: 'baseline',
            }}
          >
            [{num}]
          </button>
        );
      }
      return <React.Fragment key={key}>{part}</React.Fragment>;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.6 }}>
      {segments.map((seg, sIdx) => {
        if (!seg) return null;
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/, '');
          return (
            <pre
              key={`seg-${sIdx}`}
              style={{
                background: '#0F172A',
                color: '#F8FAFC',
                padding: '10px 12px',
                borderRadius: 8,
                overflowX: 'auto',
                fontSize: 12,
                fontFamily: 'monospace',
                margin: '4px 0',
              }}
            >
              <code>{inner}</code>
            </pre>
          );
        }

        if (seg.startsWith('$$') && seg.endsWith('$$')) {
          const math = seg.slice(2, -2).trim();
          return (
            <div
              key={`seg-${sIdx}`}
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                padding: '8px 12px',
                fontFamily: 'Cambria Math, "Times New Roman", serif',
                fontStyle: 'italic',
                textAlign: 'center',
                fontSize: 14,
                color: '#0F172A',
              }}
            >
              {math}
            </div>
          );
        }

        const lines = seg.split('\n');
        return (
          <div key={`seg-${sIdx}`} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={`ln-${lIdx}`} style={{ height: 2 }} />;

              if (/^#{1,3}\s+/.test(trimmed)) {
                const text = trimmed.replace(/^#{1,3}\s+/, '');
                return (
                  <div
                    key={`ln-${lIdx}`}
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: '#0F172A',
                      marginTop: 4,
                    }}
                  >
                    {renderInlineTokens(text, `h-${sIdx}-${lIdx}`)}
                  </div>
                );
              }

              if (/^[-*•]\s+/.test(trimmed)) {
                const text = trimmed.replace(/^[-*•]\s+/, '');
                return (
                  <div
                    key={`ln-${lIdx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      paddingLeft: 6,
                    }}
                  >
                    <span style={{ color: '#4F46E5', fontWeight: 700 }}>•</span>
                    <div style={{ flex: 1 }}>
                      {renderInlineTokens(text, `li-${sIdx}-${lIdx}`)}
                    </div>
                  </div>
                );
              }

              const numListMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
              if (numListMatch) {
                return (
                  <div
                    key={`ln-${lIdx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      paddingLeft: 4,
                    }}
                  >
                    <span style={{ color: '#4F46E5', fontWeight: 700, minWidth: 18 }}>
                      {numListMatch[1]}.
                    </span>
                    <div style={{ flex: 1 }}>
                      {renderInlineTokens(numListMatch[2], `ol-${sIdx}-${lIdx}`)}
                    </div>
                  </div>
                );
              }

              return (
                <div key={`ln-${lIdx}`}>
                  {renderInlineTokens(line, `p-${sIdx}-${lIdx}`)}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
