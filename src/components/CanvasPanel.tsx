import React, { useState } from "react";
import { Copy, Check, Download, Edit3, Trash2, X, NotebookPen, Eraser } from "lucide-react";

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
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(==[^=]+==)|(\[[^\]]+\]\([^)]+\))/g;

  return text
    .split(pattern)
    .filter((segment) => segment !== undefined && segment !== "")
    .map((segment, index) => {
      const code = segment.match(/^`([^`]+)`$/);
      if (code) {
        return (
          <code key={index} className="font-mono text-[0.85em] bg-sunken border border-line rounded px-1.5 py-0.5 text-accent">
            {code[1]}
          </code>
        );
      }
      const bold = segment.match(/^\*\*([^*]+)\*\*$/);
      if (bold) return <strong key={index} className="font-semibold">{bold[1]}</strong>;
      const italic = segment.match(/^\*([^*]+)\*$/);
      if (italic) return <em key={index}>{italic[1]}</em>;
      const highlight = segment.match(/^==([^=]+)==$/);
      if (highlight) {
        return (
          <mark key={index} className="bg-mark text-fg px-1 rounded">
            {highlight[1]}
          </mark>
        );
      }
      const link = segment.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        return (
          <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4 decoration-1 hover:decoration-2">
            {link[1]}
          </a>
        );
      }
      return <React.Fragment key={index}>{segment}</React.Fragment>;
    });
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 rounded-xl border border-line bg-sunken overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-line text-xs text-faint">
        <span className="font-mono">{lang || "code"}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
          className="inline-flex items-center gap-1 hover:text-fg transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-live" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3.5 text-[0.82rem] font-mono overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TableRenderer({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;
  const [head, ...body] = rows;
  return (
    <div className="my-3 rounded-xl border border-line overflow-x-auto">
      <table className="w-full text-left border-collapse text-[0.88rem]">
        <thead>
          <tr className="bg-sunken border-b border-line">
            {head.map((cell, i) => (
              <th key={i} className="px-3 py-2 font-semibold">
                {parseInlineMarkdown(cell.trim())}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-b border-line last:border-0">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2 text-muted align-top">
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

const BLOCK_START = /^(#{1,6}\s+|```|\|.*\|$|<details|\s*[-*+]\s+|\s*\d+\.\s+|>\s?)/;

function renderMarkdown(markdown: string): React.ReactNode[] {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = parseInlineMarkdown(heading[2]);
      blocks.push(level === 1 ? <h1 key={i}>{content}</h1> : level === 2 ? <h2 key={i}>{content}</h2> : <h3 key={i}>{content}</h3>);
      i += 1;
      continue;
    }

    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(<CodeBlock key={`code-${i}`} code={codeLines.join("\n") || " "} lang={codeMatch[1]} />);
      continue;
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        const cur = lines[i].trim();
        if (!/^[|\s\-:]+$/.test(cur)) rows.push(cur.slice(1, -1).split("|").map((c) => c.trim()));
        i += 1;
      }
      blocks.push(<TableRenderer key={`table-${i}`} rows={rows} />);
      continue;
    }

    if (/^<details/i.test(line)) {
      const inner: string[] = [];
      let summary = "Details";
      i += 1;
      while (i < lines.length && !/<\/details>/i.test(lines[i].trim())) {
        const m = lines[i].trim().match(/<summary>(.*?)<\/summary>/i);
        if (m) summary = m[1];
        else inner.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <details key={`details-${i}`} className="my-2.5 rounded-xl border border-line bg-sunken px-3.5 py-2.5">
          <summary className="font-medium cursor-pointer select-none">{summary}</summary>
          <div className="pt-2">{renderMarkdown(inner.join("\n"))}</div>
        </details>,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const m = lines[i].trim().match(/^\s*[-*+]\s+(.*)$/);
        if (!m) break;
        const task = m[1].match(/^\[( |x|X)\]\s+(.*)$/);
        items.push(
          <li key={i} className="flex items-start gap-2.5 my-1">
            {task ? (
              <span className={`mt-[0.35em] w-3.5 h-3.5 rounded border flex-shrink-0 ${task[1] === " " ? "border-line-strong" : "bg-accent border-accent"}`} />
            ) : (
              <span className="mt-[0.6em] w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
            )}
            <span>{parseInlineMarkdown(task ? task[2] : m[1])}</span>
          </li>,
        );
        i += 1;
      }
      blocks.push(<ul key={`ul-${i}`} className="my-2">{items}</ul>);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      let n = 1;
      while (i < lines.length) {
        const m = lines[i].trim().match(/^\s*\d+\.\s+(.*)$/);
        if (!m) break;
        items.push(
          <li key={i} className="flex items-start gap-2.5 my-1.5">
            <span className="font-mono text-xs text-accent mt-[0.3em] w-4 text-right flex-shrink-0">{n++}</span>
            <span>{parseInlineMarkdown(m[1])}</span>
          </li>,
        );
        i += 1;
      }
      blocks.push(<ol key={`ol-${i}`} className="my-2">{items}</ol>);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push(
        <blockquote key={i} className="my-3 border-l-2 border-accent pl-4 font-serif italic text-muted text-[1.05em]">
          {parseInlineMarkdown(quote[1])}
        </blockquote>,
      );
      i += 1;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (!cur || BLOCK_START.test(cur)) break;
      para.push(cur);
      i += 1;
    }
    blocks.push(<p key={`p-${i}`}>{parseInlineMarkdown(para.join(" "))}</p>);
  }

  return blocks;
}

export const CanvasPanel: React.FC<CanvasPanelProps> = ({ entries, onClear, onUpdateEntry, onDeleteEntry }) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries.length]);

  const fullMarkdown = () => entries.map((e) => e.markdown).join("\n\n---\n\n");

  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const download = () => {
    const blob = new Blob([fullMarkdown()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notes_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {entries.length > 0 && (
        <div className="flex items-center justify-end gap-1 px-4 py-2 border-b border-line flex-shrink-0">
          <button className="btn h-8 text-xs" onClick={() => copy("__all", fullMarkdown())}>
            {copiedId === "__all" ? <Check className="w-3.5 h-3.5 text-live" /> : <Copy className="w-3.5 h-3.5" />}
            Copy all
          </button>
          <button className="btn h-8 text-xs" onClick={download}>
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          {confirmClear ? (
            <span className="flex items-center gap-1 text-xs">
              <button
                className="btn btn-danger h-8 text-xs"
                onClick={() => {
                  onClear?.();
                  setConfirmClear(false);
                }}
              >
                Clear all notes
              </button>
              <button className="btn h-8 text-xs" onClick={() => setConfirmClear(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button className="btn h-8 text-xs" onClick={() => setConfirmClear(true)}>
              <Eraser className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="h-full flex items-center justify-center p-8">
            <div className="max-w-sm text-center rise">
              <div className="w-11 h-11 mx-auto rounded-xl bg-accent-soft text-accent flex items-center justify-center mb-4">
                <NotebookPen className="w-5 h-5" />
              </div>
              <h3 className="font-serif text-xl font-medium">Notes appear here</h3>
              <p className="text-sm text-muted mt-2 leading-relaxed">
                Ask the agent to summarise a section, make a table, or jot down what you just learned. It writes here while you talk.
              </p>
              <div className="mt-5 space-y-2 text-sm text-left">
                {["“Summarise this chapter as bullet points.”", "“Make a table comparing the two ideas.”", "“Search for the latest on this and note the sources.”"].map((s) => (
                  <div key={s} className="rounded-xl border border-line px-3.5 py-2.5 text-muted font-serif italic">
                    {s}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-[72ch] mx-auto px-6 py-6 space-y-4">
            {entries.map((entry) => {
              const editing = editingId === entry.id;
              return (
                <article key={entry.id} className="group relative panel rounded-2xl px-5 py-4 rise">
                  <div className="absolute right-3 top-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {!editing && (
                      <>
                        <button
                          className="btn btn-icon h-7 w-7"
                          onClick={() => {
                            setEditingId(entry.id);
                            setEditBuffer(entry.markdown);
                          }}
                          title="Edit"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button className="btn btn-icon h-7 w-7" onClick={() => copy(entry.id, entry.markdown)} title="Copy">
                          {copiedId === entry.id ? <Check className="w-3.5 h-3.5 text-live" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        {onDeleteEntry && (
                          <button className="btn btn-icon h-7 w-7 hover:!text-danger" onClick={() => onDeleteEntry(entry.id)} title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {editing ? (
                    <div className="space-y-2">
                      <textarea
                        autoFocus
                        value={editBuffer}
                        onChange={(e) => setEditBuffer(e.target.value)}
                        rows={Math.min(18, Math.max(5, editBuffer.split("\n").length + 1))}
                        className="field font-mono text-[0.82rem] leading-relaxed resize-y"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingId(null);
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            if (editBuffer.trim()) onUpdateEntry?.(entry.id, editBuffer.trim());
                            setEditingId(null);
                          }
                        }}
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-faint">
                          <span className="kbd">Ctrl Enter</span> to save
                        </span>
                        <div className="flex gap-1">
                          <button className="btn h-8 text-xs" onClick={() => setEditingId(null)}>
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                          <button
                            className="btn btn-primary h-8 text-xs"
                            onClick={() => {
                              if (editBuffer.trim()) onUpdateEntry?.(entry.id, editBuffer.trim());
                              setEditingId(null);
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="notes overflow-x-auto"
                      onDoubleClick={() => {
                        setEditingId(entry.id);
                        setEditBuffer(entry.markdown);
                      }}
                    >
                      {renderMarkdown(entry.markdown)}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
