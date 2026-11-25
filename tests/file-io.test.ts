import { describe, expect, it } from 'vitest';
import { markdownFilename, safeFilename } from '../src/lib/storage/file-io';
import { diagramUsage } from '../src/lib/storage/diagram-idb';

describe('file and cache boundaries', () => {
  it('accepts local text extensions and creates safe download filenames', () => {
    expect(markdownFilename.test('文档.MARKDOWN')).toBe(true);
    expect(markdownFilename.test('index.html')).toBe(false);
    expect(safeFilename(' a/b:c ' , '.md')).toBe('a-b-c.md');
    expect(safeFilename('Report.HTML', '.html')).toBe('Report.HTML');
    expect(safeFilename('...', '.png')).toBe('MDRenderTool.png');
  });

  it('counts bytes correctly both when introducing and replacing a diagram', () => {
    expect(diagramUsage({ entries: 5, bytes: 800 }, 300, 100)).toEqual({ entries: 5, bytes: 600 });
    expect(diagramUsage({ entries: 5, bytes: 800 }, undefined, 100)).toEqual({ entries: 6, bytes: 900 });
  });
});
