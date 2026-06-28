// Find-in-response: a lightweight, case-insensitive substring search over a
// response body's lines. Pure (no React / DOM) so it's unit-testable and
// reused by the ResponsePanel's search bar + highlight renderer.

export interface ResponseLineMatch {
  // Character offsets within the line, [start, end).
  start: number;
  end: number;
  // Index of this match in the flat (whole-body) match list — used to mark
  // the currently-active match while stepping through results.
  globalIndex: number;
}

export interface ResponseMatches {
  // One entry per match, in document order; index === globalIndex. Holds the
  // line each match lives on so the active match can be scrolled into view.
  flat: { line: number }[];
  // Matches grouped by line index, for highlighting only the visible window.
  perLine: Map<number, ResponseLineMatch[]>;
}

// Find every case-insensitive occurrence of `query` across `lines`. An empty
// query yields no matches. Overlapping matches don't occur — each scan
// resumes after the previous match's end.
export function computeResponseMatches(lines: string[], query: string): ResponseMatches {
  const flat: { line: number }[] = [];
  const perLine = new Map<number, ResponseLineMatch[]>();
  if (query.length === 0) return { flat, perLine };
  const needle = query.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const hay = lines[i].toLowerCase();
    let from = hay.indexOf(needle);
    while (from !== -1) {
      const globalIndex = flat.length;
      flat.push({ line: i });
      const arr = perLine.get(i) ?? [];
      arr.push({ start: from, end: from + needle.length, globalIndex });
      perLine.set(i, arr);
      from = hay.indexOf(needle, from + needle.length);
    }
  }
  return { flat, perLine };
}
