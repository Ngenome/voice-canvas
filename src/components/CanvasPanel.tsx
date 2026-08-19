import React, { useState } from "react";
import {
  Eraser,
  Copy,
  Check,
  Sparkles,
  FileCode,
  Download,
  Terminal,
  FileText,
  Clock,
  Wand2,
  Edit3,
  Trash2,
  Save,
  X,
  Table as TableIcon,
} from "lucide-react";

export interface CanvasEntry {
  id: string;
  markdown: string;
  source?: "agent" | "user" | "tool" | "system";
  createdAt?: string;
  toolName?: string;
}

interface CanvasPanelProps {
  entries: CanvasEntry[];
  onClear?: () => void;
  onUpdateEntry?: (id: string, newMarkdown: string) => void;
  onDeleteEntry?: (id: string) => void;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseInlineMarkdown(rawText: string): React.ReactNode[] {
  const text = decodeEntities(rawText);
  const pattern = /(`[^`]+`)|\*\*([^*]+)\*\*|(\*[^*]+\*)|(==[^=]+==)|(\[[^\]]+\]\([^\)]+\))/g;

  const segments = text.split(pattern);
  return segments
    .filter((segment) => segment !== undefined && segment !== "")
    .map((segment, index) => {
      if (!segment) return null;

      const match = segment.match(/^`([^`]+)`$/);
      if (match) {
        return (
          <code
            key={`inline-${index}`}
            className="bg-zinc-800/90 border border-zinc-700/60 rounded px-1.5 py-0.5 text-xs text-sky-300 font-mono"
          >
            {match[1]}
          </code>
        );
      }

      const bold = segment.match(/^\*\*([^*]+)\*\*$/);
      if (bold) {
        return (
          <strong key={`bold-${index}`} className="text-zinc-100 font-semibold">
            {bold[1]}
          </strong>
        );
      }

      const italic = segment.match(/^\*([^*]+)\*$/);
      if (italic) {
        return (
          <em key={`italic-${index}`} className="text-zinc-300 italic">
            {italic[1]}
          </em>
        );
      }

      const highlight = segment.match(/^==([^=]+)==$/);
      if (highlight) {
        return (
          <mark
            key={`mark-${index}`}
            className="bg-sky-500/20 text-sky-200 px-1 rounded border border-sky-500/30 font-medium"
          >
            {highlight[1]}
          </mark>
        );
      }

      const link = segment.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
      if (link) {
        return (
          <a
            key={`link-${index}`}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:text-sky-300 underline underline-offset-4 transition"
          >
            {link[1]}
          </a>
        );
      }

      return <React.Fragment key={`text-${index}`}>{segment}</React.Fragment>;
    });
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-xl border border-zinc-800 bg-[#0c0c10] overflow-hidden shadow-md">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-zinc-900/90 border-b border-zinc-800 text-[11px] text-zinc-400">
        <div className="flex items-center gap-1.5 font-mono">
          <Terminal className="w-3.5 h-3.5 text-sky-400" />
          <span>{lang || "code"}</span>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-100 transition cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="p-3.5 text-xs text-zinc-200 font-mono overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TableRenderer({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;
  const headerRow = rows[0];
  const bodyRows = rows.slice(1);

  return (
    <div className="my-3 rounded-xl border border-zinc-800 bg-[#0e0e13] overflow-hidden shadow-sm overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-200 font-semibold">
            {headerRow.map((cell, idx) => (
              <th key={`th-${idx}`} className="p-2.5 font-semibold text-sky-300">
                {parseInlineMarkdown(cell.trim())}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {bodyRows.map((row, rIdx) => (
            <tr key={`tr-${rIdx}`} className="hover:bg-zinc-900/40 transition-colors">
              {row.map((cell, cIdx) => (
                <td key={`td-${rIdx}-${cIdx}`} className="p-2.5 text-zinc-300">
                  {parseInlineMarkdown(cell.trim())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderMarkdown(markdown: string): React.ReactNode[] {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];

  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      i += 1;
      continue;
    }

    // 1. Headings (H1 to H6)
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      const content = heading[2];
      const headingNode = (() => {
        switch (level) {
          case 1:
            return (
              <h1 className="text-base font-bold text-zinc-100 border-b border-zinc-800/80 pb-2 mb-2">
                {parseInlineMarkdown(content)}
              </h1>
            );
          case 2:
            return (
              <h2 className="text-sm font-bold text-zinc-100 mt-3 mb-1.5">
                {parseInlineMarkdown(content)}
              </h2>
            );
          case 3:
            return (
              <h3 className="text-xs font-semibold text-sky-300 mt-2.5 mb-1">
                {parseInlineMarkdown(content)}
              </h3>
            );
          default:
            return (
              <h4 className="text-xs font-semibold text-zinc-300 mt-2 mb-1">
                {parseInlineMarkdown(content)}
              </h4>
            );
        }
      })();
      blocks.push(
        <div key={`block-${i}`} className="my-1">
          {headingNode}
        </div>,
      );
      i += 1;
      continue;
    }

    // 2. Code Block (```lang ... ```)
    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch) {
      const lang = codeMatch[1] || "";
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }

      blocks.push(
        <CodeBlock key={`code-${i}`} code={codeLines.join("\n") || " "} lang={lang} />,
      );
      continue;
    }

    // 3. Markdown Tables (| Col 1 | Col 2 |)
    if (line.startsWith("|") && line.endsWith("|")) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        const curLine = lines[i].trim();
        // Skip separator line (|---|---|)
        if (!/^[\|\s\-:]+$/.test(curLine)) {
          const cells = curLine
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim());
          tableRows.push(cells);
        }
        i += 1;
      }

      if (tableRows.length > 0) {
        blocks.push(<TableRenderer key={`table-${i}`} rows={tableRows} />);
      }
      continue;
    }

    // 4. HTML Details / Summary Callout Block
    if (/^<details/i.test(line)) {
      const detailLines: string[] = [];
      let summaryText = "Details";
      i += 1;
      while (i < lines.length && !/<\/details>/i.test(lines[i].trim())) {
        const dLine = lines[i].trim();
        const sumMatch = dLine.match(/<summary>(.*?)<\/summary>/i);
        if (sumMatch) {
          summaryText = sumMatch[1];
        } else {
          detailLines.push(lines[i]);
        }
        i += 1;
      }
      if (i < lines.length) i += 1;

      blocks.push(
        <details
          key={`details-${i}`}
          className="my-2.5 p-3 rounded-xl border border-zinc-800 bg-zinc-900/60 text-xs text-zinc-300 cursor-pointer"
        >
          <summary className="font-semibold text-sky-400 select-none">{summaryText}</summary>
          <div className="pt-2 pl-2 text-zinc-300 leading-relaxed">
            {renderMarkdown(detailLines.join("\n"))}
          </div>
        </details>,
      );
      continue;
    }

    // 5. Unordered List Items (- or * or +)
    const listItem = line.match(/^\s*[-*+]\s+(.*)$/);
    if (listItem) {
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        const match = current.match(/^\s*[-*+]\s+(.*)$/);
        if (!match) break;
        items.push(
          <li key={`list-${i}`} className="flex items-start gap-2.5 my-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-1.5 flex-shrink-0" />
            <span className="leading-relaxed">{parseInlineMarkdown(match[1])}</span>
          </li>,
        );
        i += 1;
      }

      blocks.push(
        <ul key={`block-${i}`} className="space-y-0.5 text-xs text-zinc-200 my-2 pl-0.5">
          {items}
        </ul>,
      );
      continue;
    }

    // 6. Ordered List Items (1., 2.)
    const orderedItem = line.match(/^\s*\d+\.\s+(.*)$/);
    if (orderedItem) {
      const items: React.ReactNode[] = [];
      let stepNum = 1;
      while (i < lines.length) {
        const current = lines[i].trim();
        const match = current.match(/^\s*\d+\.\s+(.*)$/);
        if (!match) break;
        items.push(
          <li key={`list-${i}`} className="flex items-start gap-2.5 my-1.5">
            <span className="text-[10px] font-mono font-semibold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.2 rounded-md flex-shrink-0">
              {stepNum++}
            </span>
            <span className="leading-relaxed">{parseInlineMarkdown(match[1])}</span>
          </li>,
        );
        i += 1;
      }

      blocks.push(
        <ol key={`block-${i}`} className="space-y-1 text-xs text-zinc-200 my-2">
          {items}
        </ol>,
      );
      continue;
    }

    // 7. Blockquote (> quote)
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push(
        <blockquote
          key={`block-${i}`}
          className="border-l-2 border-indigo-400 bg-indigo-500/5 px-3.5 py-2 rounded-r-xl text-zinc-300 italic text-xs my-2.5 leading-relaxed"
        >
          {parseInlineMarkdown(quote[1])}
        </blockquote>,
      );
      i += 1;
      continue;
    }

    // 8. Paragraph text
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const current = lines[i].trim();
      if (!current) break;
      if (
        /^(#{1,6})\s+/.test(current) ||
        /^```/.test(current) ||
        /^\|.*\|$/.test(current) ||
        /^<details/i.test(current) ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d+\.\s+/.test(current) ||
        /^>\s?/.test(current)
      ) {
        break;
      }
      paragraphLines.push(current);
      i += 1;
    }

    blocks.push(
      <p key={`block-${i}`} className="text-xs leading-relaxed text-zinc-300 my-1">
        {parseInlineMarkdown(paragraphLines.join(" "))}
      </p>,
    );
  }

  return blocks;
}

export const CanvasPanel: React.FC<CanvasPanelProps> = ({
  entries,
  onClear,
  onUpdateEntry,
  onDeleteEntry,
}) => {
  const canvasScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [allCopied, setAllCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState("");

  React.useEffect(() => {
    if (canvasScrollRef.current) {
      canvasScrollRef.current.scrollTop = canvasScrollRef.current.scrollHeight;
    }
  }, [entries]);

  const copyEntryMarkdown = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyAllCanvas = () => {
    const fullMarkdown = entries.map((e) => e.markdown).join("\n\n---\n\n");
    navigator.clipboard.writeText(fullMarkdown);
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  const downloadMarkdown = () => {
    const fullMarkdown = entries.map((e) => e.markdown).join("\n\n---\n\n");
    const blob = new Blob([fullMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `canvas_notes_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startEditing = (entry: CanvasEntry) => {
    setEditingId(entry.id);
    setEditBuffer(entry.markdown);
  };

  const saveEdit = (id: string) => {
    if (onUpdateEntry && editBuffer.trim()) {
      onUpdateEntry(id, editBuffer.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="surface-card rounded-3xl p-5 flex flex-col min-h-0 h-full min-w-0 overflow-hidden w-full relative">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.08] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-sm">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-100">
                Interactive Canvas
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700/60 font-mono">
                {entries.length} {entries.length === 1 ? "card" : "cards"}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Live documentation, code snippets, tables & visual artifacts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <>
              <button
                type="button"
                onClick={copyAllCanvas}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl surface-pill text-zinc-300 hover:text-white transition cursor-pointer"
                title="Copy full canvas markdown"
              >
                {allCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{allCopied ? "Copied" : "Copy"}</span>
              </button>

              <button
                type="button"
                onClick={downloadMarkdown}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl surface-pill text-zinc-300 hover:text-white transition cursor-pointer"
                title="Export as Markdown file"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border border-zinc-800 hover:border-rose-500/40 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={entries.length === 0}
            title="Clear canvas notes"
          >
            <Eraser className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      {/* Main Canvas Document Sheet */}
      <div
        ref={canvasScrollRef}
        className="flex-1 min-h-0 overflow-y-auto space-y-4 pt-4 pr-1.5 scroll-smooth"
      >
        {entries.length === 0 ? (
          <div className="h-full min-h-[340px] flex flex-col items-center justify-center text-center p-8 space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-sky-400 shadow-xl relative">
              <Sparkles className="w-7 h-7" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" />
            </div>

            <div className="max-w-md space-y-1.5">
              <h3 className="text-sm font-semibold text-zinc-100">Live AI Canvas Active</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                During your voice call, the AI agent can read, write, edit, or generate tables and code snippets on this canvas in real time.
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-2 w-full max-w-sm text-left">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider text-center">
                Try asking out loud:
              </span>
              <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800/90 text-xs text-zinc-300 flex items-center gap-2.5 hover:border-zinc-700 transition">
                <TableIcon className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                <span>"Create a comparative markdown table on the canvas."</span>
              </div>
              <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800/90 text-xs text-zinc-300 flex items-center gap-2.5 hover:border-zinc-700 transition">
                <Wand2 className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                <span>"What is currently on my canvas? Update section 2."</span>
              </div>
            </div>
          </div>
        ) : (
          entries.map((entry, index) => {
            const isJustCopied = copiedId === entry.id;
            const isEditingThis = editingId === entry.id;

            return (
              <article
                key={entry.id || `entry-${index}`}
                className="group relative rounded-2xl border border-zinc-800/90 bg-[#121217]/90 hover:bg-[#14141a] p-5 text-xs space-y-3 transition-all shadow-md hover:border-zinc-700/80 animate-in fade-in slide-in-from-bottom-2 duration-200"
              >
                <div className="flex items-center justify-between gap-2 border-b border-zinc-800/70 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold font-mono bg-sky-500/10 text-sky-300 border border-sky-500/20">
                      {entry.toolName || "canvas_note"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {entry.createdAt && (
                      <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-1 mr-1">
                        <Clock className="w-3 h-3" />
                        {new Date(entry.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    )}

                    {!isEditingThis ? (
                      <>
                        <button
                          onClick={() => startEditing(entry)}
                          className="p-1 rounded-lg text-zinc-400 hover:text-sky-300 hover:bg-zinc-800 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Edit markdown in-place"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => copyEntryMarkdown(entry.id, entry.markdown)}
                          className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Copy block markdown"
                        >
                          {isJustCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>

                        {onDeleteEntry && (
                          <button
                            onClick={() => onDeleteEntry(entry.id)}
                            className="p-1 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                            title="Delete this section"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => saveEdit(entry.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-[10px] font-semibold border border-emerald-500/30 transition cursor-pointer"
                        >
                          <Save className="w-3 h-3" />
                          <span>Save</span>
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded-md text-zinc-400 hover:text-white transition cursor-pointer"
                          title="Cancel editing"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isEditingThis ? (
                  <div className="space-y-2 pt-1">
                    <textarea
                      value={editBuffer}
                      onChange={(e) => setEditBuffer(e.target.value)}
                      rows={6}
                      className="w-full p-3 bg-zinc-950/90 border border-zinc-700 rounded-xl text-xs text-zinc-100 font-mono focus:outline-none focus:border-sky-500 transition resize-y leading-relaxed"
                    />
                    <p className="text-[10px] text-zinc-500">
                      Supports Markdown formatting, GFM tables, and code blocks.
                    </p>
                  </div>
                ) : (
                  <div className="canvas-markdown text-zinc-200 leading-relaxed overflow-x-auto">
                    {renderMarkdown(entry.markdown)}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
};
