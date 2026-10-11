/** Cuts a string to at most `max` UTF-16 units without leaving half of a surrogate pair (emoji). */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // high surrogate whose partner would be cut off
  return s.slice(0, end);
}
