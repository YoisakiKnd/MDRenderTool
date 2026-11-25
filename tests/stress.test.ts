import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateStress } from '../scripts/generate-stress';

const welcome = readFileSync(new URL('../src/content/welcome.md', import.meta.url), 'utf8');

describe('stress document generator', () => {
  it('uses the requested line count and includes all eight diagrams with inline formulae', () => {
    const text = generateStress(welcome, 2_000, 8);
    expect(text.split('\n')).toHaveLength(2_000);
    expect([...text.matchAll(/^```(?:mermaid|plantuml)$/gm)]).toHaveLength(8);
    expect(text.match(/\$E=mc\^2\$/g)).toHaveLength(8);
  });

  it('validates the user-supplied limits', () => {
    expect(() => generateStress(welcome, 17, 1)).toThrow(RangeError);
    expect(() => generateStress(welcome, 50_000, 201)).toThrow(RangeError);
  });
});
