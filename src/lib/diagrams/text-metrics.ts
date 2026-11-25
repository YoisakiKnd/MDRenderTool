const narrow = new Set("iltfrjI1.,:;|' ");
const wide = new Set('WM@%#&');
const fullWidth = /[\u2e80-\ua4cf\uf900-\ufaff\uff00-\uffef\p{Extended_Pictographic}]/u;

export function measureText(text: string, fontSize = 14, bold = false, maxWidth = 240): {
  width: number; height: number; lines: string[];
} {
  const coefficient = bold ? 1.06 : 1;
  const widthOf = (char: string) => coefficient * fontSize *
    (narrow.has(char) ? .35 : wide.has(char) ? .82 : fullWidth.test(char) ? 1.02 : .62);
  const lines: string[] = [];
  let widest = 0;
  for (const paragraph of text.split(/\n|<br\s*\/?>/i)) {
    let row = '';
    let rowWidth = 0;
    const flush = () => { lines.push(row.trimEnd()); widest = Math.max(widest, rowWidth); row = ''; rowWidth = 0; };
    const words = paragraph.match(/\s+|[\u0021-\u007e]+|[^\s]/gu) ?? [];
    for (const word of words) {
      const wordWidth = Array.from(word).reduce((sum, char) => sum + widthOf(char), 0);
      if (rowWidth && rowWidth + wordWidth > maxWidth - 4 && !/^\s/.test(word)) flush();
      if (wordWidth > maxWidth - 4 && !/^\s/.test(word)) {
        for (const char of word) {
          const size = widthOf(char);
          if (rowWidth && rowWidth + size > maxWidth - 4) flush();
          row += char;
          rowWidth += size;
        }
      } else if (row || !/^\s/.test(word)) {
        row += word;
        rowWidth += wordWidth;
      }
    }
    flush();
  }
  return { lines, width: Math.ceil(widest + 4), height: Math.ceil(lines.length * fontSize * 1.4) };
}
