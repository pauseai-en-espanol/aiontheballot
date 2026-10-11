import { describe, expect, it } from 'vitest';

import { fill } from './fill';

describe('fill', () => {
  it('fills every placeholder it has a value for, and leaves the others', () => {
    expect(fill('Quitar el rol {role} a {name}', { role: 'Edición', name: 'Persona' })).toBe(
      'Quitar el rol Edición a Persona',
    );
    expect(fill('{name} y {other}', { name: 'Persona' })).toBe('Persona y {other}');
  });

  it("doesn't read replacement patterns in the values", () => {
    expect(fill('{name}', { name: '$& $1' })).toBe('$& $1');
  });
});
