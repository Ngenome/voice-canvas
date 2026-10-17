// Live captions for the agent's voice.
//
// ElevenLabs sends character timings with each audio chunk ("audio alignment").
// We schedule every character to appear when its sound plays, so captions follow
// the voice. If no timings arrive, the agent's text is revealed at speaking pace.

/** text = revealed so far; active = should be visible; pending = more characters still to come. */
type Listener = (text: string, active: boolean, pending: boolean) => void;

/** Rough delay between receiving audio and hearing it (buffering). */
const PLAYBACK_LATENCY_MS = 180;
/** Fallback reveal speed when there are no timings (characters per second). */
const FALLBACK_CPS = 15;
/** Silence after which the next speech starts a fresh caption. */
const NEW_UTTERANCE_GAP_MS = 1800;

export class CaptionEngine {
  private text = "";
  private queue: { ch: string; at: number }[] = [];
  private tail = 0; // when the last scheduled character finishes
  private lastRevealAt = 0;
  private raf = 0;
  private sawAlignment = false;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.text, this.isActive(), this.queue.length > 0);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Character timings for one chunk of agent audio. */
  onAlignment(a: { chars: string[]; char_start_times_ms: number[]; char_durations_ms: number[] }) {
    if (!a?.chars?.length) return;
    this.sawAlignment = true;
    const now = performance.now();
    this.maybeStartNewUtterance(now);
    const start = Math.max(now + PLAYBACK_LATENCY_MS, this.tail);
    a.chars.forEach((ch, i) => this.queue.push({ ch, at: start + (a.char_start_times_ms[i] ?? 0) }));
    const last = a.chars.length - 1;
    this.tail = start + (a.char_start_times_ms[last] ?? 0) + (a.char_durations_ms[last] ?? 0);
    this.run();
  }

  /** Full agent message. Only used when timings aren't available. */
  onAgentText(message: string) {
    if (this.sawAlignment || !message) return;
    const now = performance.now();
    this.maybeStartNewUtterance(now);
    let at = Math.max(now, this.tail);
    const text = (this.text ? " " : "") + message;
    for (const ch of text) {
      this.queue.push({ ch, at });
      at += 1000 / FALLBACK_CPS;
    }
    this.tail = at;
    this.run();
  }

  /** The user cut the agent off: drop what hasn't been spoken yet. */
  interrupt() {
    this.queue = [];
    this.tail = 0;
    this.emit();
  }

  reset() {
    this.queue = [];
    this.tail = 0;
    this.text = "";
    this.sawAlignment = false;
    this.emit();
  }

  private maybeStartNewUtterance(now: number) {
    if (this.queue.length === 0 && now - Math.max(this.lastRevealAt, this.tail) > NEW_UTTERANCE_GAP_MS) {
      this.text = "";
    }
  }

  private isActive() {
    return this.queue.length > 0 || performance.now() - this.lastRevealAt < 4000;
  }

  private run() {
    if (this.raf) return;
    const tick = () => {
      const now = performance.now();
      let changed = false;
      while (this.queue.length && this.queue[0].at <= now) {
        this.text += this.queue.shift()!.ch;
        changed = true;
      }
      if (changed) {
        this.lastRevealAt = now;
        // Keep memory small; the strip only shows the tail anyway.
        if (this.text.length > 2000) {
          const cut = this.text.indexOf(" ", this.text.length - 1000);
          this.text = this.text.slice(cut > 0 ? cut + 1 : -1000);
        }
        this.emit();
      }
      if (this.queue.length) {
        this.raf = requestAnimationFrame(tick);
      } else {
        this.raf = 0;
        // Let listeners know when captions go idle so they can fade out.
        setTimeout(() => this.emit(), 4100);
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  private emit() {
    const active = this.isActive();
    const pending = this.queue.length > 0;
    for (const fn of this.listeners) fn(this.text, active, pending);
  }
}
