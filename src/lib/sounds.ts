// Short, soft audio cues for call state, so you know what happened without looking.
// Generated with Web Audio (no files): rising = connected, falling = ended, low double = dropped.

type Cue = "connect" | "end" | "pause" | "resume" | "drop";

let ctx: AudioContext | null = null;

function tone(c: AudioContext, freq: number, start: number, dur: number, gain = 0.06) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.02);
}

export function playCue(cue: Cue) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const c = ctx;
    switch (cue) {
      case "connect":
        tone(c, 660, 0, 0.14);
        tone(c, 990, 0.12, 0.2);
        break;
      case "resume":
        tone(c, 740, 0, 0.12);
        tone(c, 990, 0.1, 0.16);
        break;
      case "end":
        tone(c, 880, 0, 0.14);
        tone(c, 587, 0.12, 0.22);
        break;
      case "pause":
        tone(c, 700, 0, 0.12, 0.05);
        tone(c, 700, 0.16, 0.12, 0.05);
        break;
      case "drop":
        tone(c, 330, 0, 0.18, 0.08);
        tone(c, 247, 0.2, 0.3, 0.08);
        break;
    }
  } catch {
    // Audio cues are a nicety; ignore if the browser blocks them.
  }
}
