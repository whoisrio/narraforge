/**
 * SRT content parsing helpers for E2E assertions.
 * Parses "HH:MM:SS,mmm --> HH:MM:SS,mmm" cue blocks back to millisecond
 * timestamps so specs can verify cue count, contiguity, and durations.
 */

export interface SrtCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

const TS = /(\d+):(\d+):(\d+),(\d+)\s+-->\s+(\d+):(\d+):(\d+),(\d+)/;

function toMs(h: string, m: string, s: string, ms: string): number {
  return (+h) * 3_600_000 + (+m) * 60_000 + (+s) * 1_000 + (+ms);
}

/** Parse SRT content into ordered cues. */
export function parseSrtCues(content: string): SrtCue[] {
  return content
    .trim()
    .split(/\r?\n\r?\n+/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const m = lines[1]?.match(TS);
      if (!m) throw new Error(`unparseable SRT cue block: ${block}`);
      return {
        index: Number(lines[0]),
        startMs: toMs(m[1], m[2], m[3], m[4]),
        endMs: toMs(m[5], m[6], m[7], m[8]),
        text: lines.slice(2).join('\n'),
      };
    });
}
