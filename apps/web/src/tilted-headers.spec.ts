import { describe, expect, it } from 'vitest';

import { tiltedHeaderRoom } from './tilted-headers';

describe('tiltedHeaderRoom', () => {
  it('needs no room without titles', () => {
    expect(tiltedHeaderRoom([])).toEqual({ rise: 0, overhang: 0 });
  });

  it('rises as high as the longest title reaches at 45°, whatever its column', () => {
    // 40 characters, a short title's most, reach 40 × sin 45° ≈ 28.3 up.
    expect(tiltedHeaderRoom(['Empleo', 'x'.repeat(40), 'AESIA']).rise).toBe(29);
    expect(tiltedHeaderRoom(['x'.repeat(40), 'Empleo']).rise).toBe(29);
  });

  it('counts characters as a reader sees them, so an accent or an emoji counts once', () => {
    expect(tiltedHeaderRoom(['Formación']).rise).toBe(tiltedHeaderRoom(['Formacion']).rise);
    // A decomposed accent (o and a combining acute) and an emoji with its variation selector are one each.
    expect(tiltedHeaderRoom(['Formación']).rise).toBe(tiltedHeaderRoom(['Formacion']).rise);
    expect(tiltedHeaderRoom(['🗳️'.repeat(9)]).rise).toBe(tiltedHeaderRoom(['x'.repeat(9)]).rise);
  });

  it('leaves room past the last column for the title that reaches furthest beyond it', () => {
    // The last title, 16 characters from the middle of the last column: 16 × 0.707 − 0.5 × 4 ≈ 9.3.
    expect(tiltedHeaderRoom(['Riesgo existencial', 'Centros de datos']).overhang).toBe(10);
    // A long title one column earlier reaches past a short last one: 30 × 0.707 − 1.5 × 4 ≈ 15.2.
    expect(tiltedHeaderRoom(['x'.repeat(30), 'AESIA']).overhang).toBe(16);
  });

  it("needs nothing past the end when every title ends over the table's own columns", () => {
    expect(tiltedHeaderRoom(['Riesgo existencial', 'a', 'b', 'c', 'd']).overhang).toBe(0);
  });
});
