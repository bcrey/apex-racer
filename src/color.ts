/** Blends two #rrggbb colours; `t` = 0 gives `a`, 1 gives `b`. */
export function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** Lightens (positive `amount`) or darkens (negative) a #rrggbb colour. */
export function shade(hex: string, amount: number) {
  return amount < 0 ? mixHex(hex, '#000000', -amount) : mixHex(hex, '#ffffff', amount);
}
