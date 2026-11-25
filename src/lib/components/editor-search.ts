import { keymap } from '@codemirror/view';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';

export const searchExtension = [search({ top: true }), keymap.of(searchKeymap)];
export { openSearchPanel };
