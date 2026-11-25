export type BlockKind = 'heading' | 'paragraph' | 'list' | 'blockquote' | 'table'
  | 'code' | 'diagram' | 'math' | 'hr' | 'footnote_section' | 'html';

export type ThemeMode = 'light' | 'dark';
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface DiagramSource {
  fenceLang: string;
  detectedType: string;
  source: string;
  sourceHash: string;
}

export interface Heading {
  level: HeadingLevel;
  text: string;
  slug: string;
}

export interface ParsedBlock {
  index: number;
  hash: string;
  kind: BlockKind;
  startLine: number;
  endLine: number;
  estimatedHeight: number;
  html?: string;
  unchanged?: boolean;
  diagram?: DiagramSource;
  heading?: Heading;
}

export interface TocItem extends Heading {
  blockIndex: number;
  line: number;
}

export interface FootnoteEntry {
  id: string;
  label: string;
  html: string;
  line: number;
}

export interface DocStats {
  wordCount: number;
  charCount: number;
  lineCount: number;
  blockCount: number;
  parseMs: number;
}

export type WorkerRequest =
  | { type: 'PARSE_DOC'; docVersion: number; baseVersion?: number; text: string; themeMode: ThemeMode }
  | { type: 'RENDER_DIAGRAM'; requestId: string; fenceLang: string; source: string; sourceHash: string; themeMode: ThemeMode }
  | { type: 'CANCEL_DIAGRAMS'; requestIds: string[] };

export interface ParseResult {
  type: 'PARSE_RESULT';
  docVersion: number;
  blocks: ParsedBlock[];
  toc: TocItem[];
  footnotes: Record<string, FootnoteEntry>;
  hasMath: boolean;
  stats: DocStats;
}

export interface DiagramReply {
  type: 'DIAGRAM_RESULT';
  requestId: string;
  sourceHash: string;
  status: 'ok' | 'unsupported' | 'error';
  diagramType?: string;
  svg?: string;
  width?: number;
  height?: number;
  reason?: string;
  errorLine?: number;
  renderMs: number;
}

export type WorkerResponse = ParseResult | DiagramReply
  | { type: 'PARSE_ERROR'; docVersion: number; reason: string };
