import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import kotlin from 'shiki/langs/kotlin.mjs';
import rust from 'shiki/langs/rust.mjs';
import go from 'shiki/langs/go.mjs';
import typescript from 'shiki/langs/typescript.mjs';

// TextMate token colors inspired by the Kotlin website, shared by server and browser.
const theme = {
  name: 'kotlin-website', type: 'dark',
  colors: { 'editor.background': '#0d0d0d', 'editor.foreground': '#a9b7c6' },
  tokenColors: [
    { scope: ['comment'], settings: { foreground: '#629755', fontStyle: 'italic' } },
    { scope: ['keyword', 'storage'], settings: { foreground: '#cc7832' } },
    { scope: ['string'], settings: { foreground: '#6a8759' } },
    { scope: ['constant.numeric'], settings: { foreground: '#6897bb' } },
    { scope: ['constant.language'], settings: { foreground: '#cc7832' } },
    { scope: ['support.function'], settings: { foreground: '#a9b7c6' } },
    { scope: ['entity.name.function'], settings: { foreground: '#a9b7c6', fontStyle: 'italic' } },
    { scope: ['support.type'], settings: { foreground: '#a9b7c6' } },
    { scope: ['entity.name.type'], settings: { foreground: '#a9b7c6', fontStyle: 'italic' } },
    { scope: ['entity.name.namespace'], settings: { foreground: '#a9b7c6' } },
    { scope: ['entity.name.type.annotation', 'storage.type.annotation', 'meta.annotation'], settings: { foreground: '#bbb529' } },
    { scope: ['constant.character.escape'], settings: { foreground: '#cc7832' } },
    { scope: ['variable'], settings: { foreground: '#a9b7c6' } },
    { scope: ['keyword.operator'], settings: { foreground: '#a9b7c6' } },
  ],
};
let highlighter;
export async function highlightCode(source, lang = 'kotlin') {
  highlighter ||= createHighlighterCore({ langs: [kotlin, rust, go, typescript], themes: [theme], engine: createJavaScriptRegexEngine() });
  return (await highlighter).codeToHtml(source, { lang, theme: theme.name });
}

export const highlightKotlin = (source) => highlightCode(source);
