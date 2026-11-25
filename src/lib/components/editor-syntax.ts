import { keymap } from '@codemirror/view';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from '@codemirror/language';

export const sourceSyntax = [
  markdownLanguage, syntaxHighlighting(defaultHighlightStyle), bracketMatching(), foldGutter(), keymap.of(foldKeymap),
];
