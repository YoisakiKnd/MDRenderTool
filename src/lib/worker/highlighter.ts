import { escapeMarkup } from '../core/escape';

type Kind = 'comment' | 'string' | 'keyword' | 'number' | 'type' | 'function' | 'operator' | 'punctuation' | 'attr';
interface Rule { kind: Kind; pattern: RegExp }

const rule = (kind: Kind, source: string): Rule => ({ kind, pattern: new RegExp(source, 'y') });
const string = rule('string', String.raw`"(?:[^"\\\n]|\\[^\n])*"?|'(?:[^'\\\n]|\\[^\n])*'?`);
const template = rule('string', String.raw`\x60(?:[^\x60\\]|\\[\s\S])*\x60?`);
const slash = rule('comment', String.raw`//[^\n]*|/\*[\s\S]*?(?:\*/|$)`);
const hash = rule('comment', String.raw`#[^\n]*`);
const sqlComment = rule('comment', String.raw`--[^\n]*|/\*[\s\S]*?(?:\*/|$)`);
const markupComment = rule('comment', String.raw`<!--[\s\S]*?(?:-->|$)`);
const attr = rule('attr', String.raw`[\w:-]{1,256}(?=[ \t]*[:=])`);
const markup = rule('type', String.raw`</?[\w:-]+`);
const common = [
  rule('number', String.raw`(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?)`),
  rule('function', String.raw`[A-Za-z_$][\w$]*(?=[ \t]*\()`),
  rule('operator', String.raw`[+*/=<>!%&|^~?:-]+`),
  rule('punctuation', String.raw`[{}()[\],;.]`),
];

const definitions = new Map<string, { rules: Rule[]; keywords: Set<string> }>();

function language(names: string, words: string, rules: Rule[] = [slash, string]): void {
  const configuration = { rules: [...rules, ...common], keywords: new Set(words.split(' ')) };
  for (const name of names.split(' ')) definitions.set(name, configuration);
}

const control = 'if else for while do switch case break continue return try catch throw default';
const js = `${control} const let var function class extends new import export from as async await true false null undefined this super of in typeof void yield finally delete`;
language('javascript js jsx mjs', js, [slash, template, string]);
language('typescript ts tsx', `${js} interface type implements enum keyof infer readonly declare satisfies private protected public unknown never`, [slash, template, string]);
language('python py', 'def class if elif else for while return import from as with lambda pass yield async await True False None in not and or try except finally raise break continue print', [hash, string]);
language('go golang', `${control} package import func var const range struct interface type map chan go defer select nil true false`);
language('rust rs', `${control} fn let mut pub mod use struct enum impl trait match loop async await dyn self Self crate extern true false`);
language('java', `${control} package import public protected private static final void class extends implements interface new null true false synchronized record`);
language('c', `${control} int char float double long void struct union typedef enum sizeof return static extern const volatile unsigned`, [hash, slash, string]);
language('cpp c++ cc', `${control} int char float double long void auto class struct template typename namespace using extern const new delete nullptr public private constexpr concept`, [hash, slash, string]);
language('csharp cs', `${control} namespace using public private protected class record struct var let static async await new delegate event null true false`);
language('sql', 'select from where join inner outer left right cross update insert delete values create table into order by group having as asc desc null and or is union distinct limit count', [sqlComment, string]);
language('json', 'true false null', [rule('attr', String.raw`"(?:[^"\\\n]|\\[^\n])*"(?=[ \t]*:)`), string]);
language('yaml yml', 'true false null yes no on off', [hash, attr, string]);
language('html xml svg svelte', '', [markupComment, markup, attr, string]);
language('css scss', 'important inherit initial unset', [slash, attr, string]);
language('bash sh zsh shell', 'if then fi else elif for while do done in case esac function local export echo exit', [hash, string]);
language('markdown md', '', [rule('keyword', String.raw`#{1,6}(?= )`), template, markupComment]);
language('diff', '', [rule('string', String.raw`\+[^\n]*`), rule('keyword', String.raw`-[^\n]*`), rule('comment', String.raw`@@[^\n]*`)]);

const word = /[A-Za-z_$][\w$]*/y;
const encoder = new TextEncoder();

export function highlightCode(source: string, languageName: string): { html: string; skipped: boolean } {
  const normalized = languageName.toLowerCase();
  const language = definitions.get(normalized);
  if (source.length > 100_000 || (source.match(/\n/g)?.length ?? 0) > 2_000 ||
      (source.length > 33_333 && encoder.encode(source).byteLength > 100_000)) {
    return { html: escapeMarkup(source), skipped: true };
  }
  if (!language) return { html: escapeMarkup(source), skipped: false };

  const pieces: string[] = [];
  let plainStart = 0;
  for (let index = 0; index < source.length;) {
    let lexeme: string | undefined;
    let kind: Kind | undefined;
    word.lastIndex = index;
    const identifier = word.exec(source)?.[0];
    if (identifier && language.keywords.has(normalized === 'sql' ? identifier.toLowerCase() : identifier)) {
      lexeme = identifier;
      kind = 'keyword';
    } else {
      for (const rule of language.rules) {
        rule.pattern.lastIndex = index;
        const match = rule.pattern.exec(source);
        if (match) {
          lexeme = match[0];
          kind = rule.kind;
          break;
        }
      }
    }

    if (!lexeme) {
      index += identifier?.length ?? 1;
      continue;
    }
    if (plainStart < index) pieces.push(escapeMarkup(source.slice(plainStart, index)));
    pieces.push(`<span class="hl-${kind}">${escapeMarkup(lexeme)}</span>`);
    index += lexeme.length;
    plainStart = index;
  }
  pieces.push(escapeMarkup(source.slice(plainStart)));
  return { html: pieces.join(''), skipped: false };
}
