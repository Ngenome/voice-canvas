// Turns PDFs and pasted text into a list of readable paragraphs.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface DocParagraph {
  text: string;
  page?: number;
  isHeading?: boolean;
}

/** A highlight on a PDF page. Rects are fractions of the page (0..1), so they fit any zoom. */
export interface Highlight {
  id: string;
  page: number;
  text: string;
  rects: { x: number; y: number; w: number; h: number }[];
  createdAt: string;
  /** Carried from an older version but its text wasn't found in this one. */
  missing?: boolean;
}

export interface ReadingDocument {
  id: string;
  title: string;
  source: "pdf" | "text" | "web";
  paragraphs: DocParagraph[];
  pageCount?: number;
  /** Original PDF stored on the local server, for page view. */
  fileId?: string;
  /** Pages that contain images or diagrams (1-based). */
  figurePages?: number[];
  /** Highlights the user made on PDF pages. */
  highlights?: Highlight[];
  /** Versions of the same document share a group id (the first version's id). */
  groupId?: string;
  /** 1 for the first version. */
  version?: number;
  position: number; // index of the paragraph being read, -1 = not started
  createdAt: string;
}

const MAX_PARAGRAPH_CHARS = 1400;

function newId() {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function looksLikeHeading(text: string): boolean {
  if (text.length > 90) return false;
  if (/[.,;:]$/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 12) return false;
  return /^(\d+(\.\d+)*\.?\s+)?[A-Z]/.test(text);
}

/** Splits overly long paragraphs at sentence boundaries so each read stays short. */
function splitLong(p: DocParagraph): DocParagraph[] {
  if (p.text.length <= MAX_PARAGRAPH_CHARS) return [p];
  const sentences = p.text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [p.text];
  const out: DocParagraph[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + s.length > MAX_PARAGRAPH_CHARS) {
      out.push({ ...p, text: buf.trim() });
      buf = "";
    }
    buf += s;
  }
  if (buf.trim()) out.push({ ...p, text: buf.trim() });
  return out;
}

export function documentFromText(raw: string, title?: string): ReadingDocument {
  const text = raw.replace(/\r/g, "").trim();
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  const paragraphs = blocks
    .map((b): DocParagraph => {
      const md = b.match(/^#{1,6}\s+(.*)$/);
      if (md) return { text: md[1], isHeading: true };
      return { text: b, isHeading: looksLikeHeading(b) && blocks.length > 3 };
    })
    .flatMap(splitLong);

  const firstLine = text.split("\n")[0].replace(/^#+\s*/, "").trim();
  return {
    id: newId(),
    title: title || (firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine) || "Pasted text",
    source: "text",
    paragraphs,
    position: -1,
    createdAt: new Date().toISOString(),
  };
}

// ── Original PDF storage & page rendering ───────────────────────────────

export async function uploadPdf(file: Blob): Promise<string> {
  const res = await fetch("/api/files", { method: "POST", body: file, headers: { "Content-Type": "application/pdf" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.fileId) throw new Error(data.error || "Couldn't store the PDF.");
  return data.fileId as string;
}

const pdfCache = new Map<string, Promise<pdfjs.PDFDocumentProxy>>();

export function loadPdf(fileId: string): Promise<pdfjs.PDFDocumentProxy> {
  let p = pdfCache.get(fileId);
  if (!p) {
    p = pdfjs.getDocument({
      url: `/api/files/${encodeURIComponent(fileId)}`,
      rangeChunkSize: 1 << 20,
      disableAutoFetch: true,
      disableStream: true,
    }).promise;
    p.catch(() => pdfCache.delete(fileId));
    pdfCache.set(fileId, p);
  }
  return p;
}

/** Renders one page into a canvas at the given CSS width. */
export async function renderPage(
  pdf: pdfjs.PDFDocumentProxy,
  pageNum: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  onTask?: (task: pdfjs.RenderTask) => void,
) {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const task = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport });
  onTask?.(task);
  await task.promise;
  return task;
}

/**
 * Lays the page's real text over the drawn page as invisible, selectable text,
 * so you can select, copy and highlight it like in a browser's PDF viewer.
 * The container must set --total-scale-factor (CSS px per PDF point).
 */
export async function renderTextLayer(pdf: pdfjs.PDFDocumentProxy, pageNum: number, container: HTMLElement, cssWidth: number) {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const viewport = page.getViewport({ scale });
  // pdf.js sizes the layer and its text from these variables.
  container.style.setProperty("--total-scale-factor", String(scale));
  container.style.setProperty("--scale-round-x", "1px");
  container.style.setProperty("--scale-round-y", "1px");
  container.replaceChildren();
  const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
  await layer.render();
  return layer;
}

/** Renders a page to a JPEG blob, e.g. to show the agent a diagram. */
export async function pageToBlob(fileId: string, pageNum: number, width = 1400): Promise<Blob> {
  const pdf = await loadPdf(fileId);
  const canvas = document.createElement("canvas");
  await renderPage(pdf, pageNum, canvas, width / Math.min(window.devicePixelRatio || 1, 2));
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't capture the page."))), "image/jpeg", 0.85),
  );
}

const IMAGE_OPS = new Set<number>([
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintImageMaskXObject,
  pdfjs.OPS.paintImageXObjectRepeat,
]);

/** True when a page draws images or a lot of vector paths (charts, diagrams). */
async function pageHasFigure(page: pdfjs.PDFPageProxy): Promise<boolean> {
  try {
    const ops = await page.getOperatorList();
    let paths = 0;
    for (const fn of ops.fnArray) {
      if (IMAGE_OPS.has(fn)) return true;
      if (fn === pdfjs.OPS.constructPath) paths++;
    }
    return paths >= 80;
  } catch {
    return false;
  }
}

/** Finds figure pages for a stored PDF (used when attaching a file to an older document). */
export async function scanFigurePages(fileId: string, onProgress?: (page: number, total: number) => void): Promise<number[]> {
  const pdf = await loadPdf(fileId);
  const pages: number[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress?.(n, pdf.numPages);
    if (await pageHasFigure(await pdf.getPage(n))) pages.push(n);
  }
  return pages;
}

type TextItem = { str: string; transform: number[]; height: number };

export async function documentFromPdf(file: File, onProgress?: (page: number, total: number) => void): Promise<ReadingDocument> {
  // Store the original in parallel so page view works later.
  const upload = uploadPdf(file).catch((e) => {
    console.warn("PDF upload failed; page view will be unavailable.", e);
    return undefined;
  });
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const paragraphs: DocParagraph[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.(pageNum, pdf.numPages);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items.filter((it) => "str" in it) as unknown as TextItem[];

    // Group items into lines by their vertical position.
    const lines: { y: number; size: number; text: string }[] = [];
    for (const it of items) {
      const y = it.transform[5];
      const size = Math.abs(it.transform[3]) || it.height || 10;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < size * 0.5) {
        last.text += it.str;
      } else {
        lines.push({ y, size, text: it.str });
      }
    }

    const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
    const bodySize = sizes[Math.floor(sizes.length / 2)] || 10;

    // Merge lines into paragraphs using vertical gaps and sentence endings.
    let current: { text: string; size: number } | null = null;
    let prevY = 0;
    const flush = () => {
      if (!current) return;
      const text = current.text.replace(/\s+/g, " ").replace(/(\w)- (\w)/g, "$1$2").trim();
      if (text && !/^\d+$/.test(text)) {
        const isHeading = current.size > bodySize * 1.15 && text.length < 120;
        paragraphs.push(...splitLong({ text, page: pageNum, isHeading }));
      }
      current = null;
    };

    for (const line of lines) {
      const t = line.text.trim();
      if (!t) continue;
      const gap = current ? prevY - line.y : 0;
      const sizeChanged = current && Math.abs(line.size - current.size) > bodySize * 0.12;
      const bigGap = current && gap > line.size * 1.6;
      if (!current || sizeChanged || bigGap) {
        flush();
        current = { text: t, size: line.size };
      } else {
        current.text += (current.text.endsWith("-") ? "" : " ") + t;
      }
      prevY = line.y;
    }
    flush();
  }

  // File names are more reliable than PDF metadata titles, which are often stale.
  const fileTitle = file.name.replace(/\.pdf$/i, "").trim();
  const meta = fileTitle ? null : await pdf.getMetadata().catch(() => null);
  const metaTitle = (meta?.info as { Title?: string } | undefined)?.Title?.trim();

  return {
    id: newId(),
    title: fileTitle || metaTitle || "Untitled PDF",
    source: "pdf",
    paragraphs,
    pageCount: pdf.numPages,
    fileId: await upload,
    position: -1,
    createdAt: new Date().toISOString(),
  };
}

export function parseStoredDocument(raw: unknown): ReadingDocument | null {
  if (!raw) return null;
  try {
    const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (doc && Array.isArray(doc.paragraphs)) return doc as ReadingDocument;
  } catch {}
  return null;
}

// ── Shelf: several documents (and versions) in one session ─────────────

export interface Shelf {
  activeId: string | null;
  documents: ReadingDocument[];
}

export const emptyShelf = (): Shelf => ({ activeId: null, documents: [] });

/** Reads what a session stored: a shelf, or (older sessions) a single document. */
export function parseShelf(raw: unknown): Shelf {
  if (!raw) return emptyShelf();
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (data && Array.isArray(data.documents)) {
      const documents = (data.documents as ReadingDocument[]).filter((d) => d && Array.isArray(d.paragraphs));
      const activeId = documents.some((d) => d.id === data.activeId) ? data.activeId : documents[documents.length - 1]?.id ?? null;
      return { activeId, documents };
    }
    if (data && Array.isArray(data.paragraphs)) return { activeId: data.id, documents: [data as ReadingDocument] };
  } catch {}
  return emptyShelf();
}

export const serializeShelf = (s: Shelf) => JSON.stringify({ kind: "shelf", activeId: s.activeId, documents: s.documents });

export const groupOf = (d: ReadingDocument) => d.groupId ?? d.id;
export const versionOfDoc = (d: ReadingDocument) => d.version ?? 1;

/** All versions of the document's group, oldest first. */
export function versionsOf(docs: ReadingDocument[], d: ReadingDocument) {
  const g = groupOf(d);
  return docs.filter((x) => groupOf(x) === g).sort((a, b) => versionOfDoc(a) - versionOfDoc(b));
}

/** One entry per group (the tab strip), in the order the groups were added. */
export function shelfGroups(docs: ReadingDocument[]) {
  const seen = new Map<string, ReadingDocument[]>();
  for (const d of docs) {
    const g = groupOf(d);
    if (!seen.has(g)) seen.set(g, []);
    seen.get(g)!.push(d);
  }
  return [...seen.values()].map((vs) => vs.sort((a, b) => versionOfDoc(a) - versionOfDoc(b)));
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Turns a freshly opened file into the next version of `old`: same group, version + 1,
 * reading place carried over by matching text, and highlights moved to where their
 * text now appears (pages are re-measured when the page is next shown).
 */
export function makeNewVersion(old: ReadingDocument, fresh: ReadingDocument, allDocs: ReadingDocument[]) {
  const latest = Math.max(...versionsOf(allDocs, old).map(versionOfDoc));

  // Reading place: same passage text if it still exists, else the same relative spot.
  let position = -1;
  if (old.position >= 0) {
    const was = old.paragraphs[old.position]?.text ?? "";
    const exact = fresh.paragraphs.findIndex((p) => p.text === was);
    const prefix = was.length > 30 ? fresh.paragraphs.findIndex((p) => norm(p.text).startsWith(norm(was).slice(0, 60))) : -1;
    position =
      exact >= 0 ? exact : prefix >= 0 ? prefix : Math.round((old.position / Math.max(1, old.paragraphs.length)) * fresh.paragraphs.length);
  }

  let moved = 0;
  const missing: string[] = [];
  const highlights = (old.highlights || []).map((h) => {
    const needle = norm(h.text);
    const idx = fresh.paragraphs.findIndex((p) => norm(p.text).includes(needle));
    if (idx < 0 || !fresh.paragraphs[idx].page) {
      missing.push(h.text);
      return { ...h, rects: [], missing: true };
    }
    moved++;
    return { ...h, page: fresh.paragraphs[idx].page!, rects: [], missing: false };
  });

  const doc: ReadingDocument = {
    ...fresh,
    title: old.title,
    groupId: groupOf(old),
    version: latest + 1,
    position,
    highlights,
  };
  return { doc, moved, missing };
}

/** Passage-level differences between two versions, for "what changed?". */
export function diffVersions(a: ReadingDocument, b: ReadingDocument) {
  const aSet = new Set(a.paragraphs.map((p) => norm(p.text)));
  const bSet = new Set(b.paragraphs.map((p) => norm(p.text)));
  const added = b.paragraphs.filter((p) => !aSet.has(norm(p.text)));
  const removed = a.paragraphs.filter((p) => !bSet.has(norm(p.text)));
  return { added, removed };
}
