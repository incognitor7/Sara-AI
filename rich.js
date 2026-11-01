/* Sara AI · Renderizado enriquecido: Markdown + bloques de código con resaltado.
   Rich.md(t): mensajes y lecciones (con herramientas) · Rich.rich(t): enunciados, opciones, explicaciones. */
(() => {
'use strict';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LANGS = ['python','javascript','typescript','java','c','cpp','csharp','html','css','sql','bash','json','php','go','rust','kotlin','swift'];
// Si la IA devuelve "\n" literales dentro de un bloque ```, los convierte en saltos reales
const fix = t => { t = String(t ?? ''); return /```/.test(t) && !/\n/.test(t) ? t.replace(/\\n/g, '\n') : t; };
function block(code, lang) {
  code = String(code).replace(/\n$/, ''); let l = String(lang || '').split(/\s/)[0].toLowerCase(), h;
  try {
    if (l && hljs.getLanguage(l)) h = hljs.highlight(code, {language: l, ignoreIllegals: true}).value;
    else { const r = hljs.highlightAuto(code, LANGS); h = r.value; l = l || r.language || 'código'; }
  } catch { h = esc(code); }
  return `<div class="cb"><div class="cbh"><span>${esc(l || 'código')}</span><button type="button" class="copy">Copiar</button></div><pre><code>${h}</code></pre></div>`;
}
const make = tools => new marked.Marked({gfm: true, renderer: {code(a, b) {
  const c = typeof a === 'object' ? a.text : a, l = typeof a === 'object' ? a.lang : b;
  return (tools && window.Tools && Tools.placeholder(c)) || block(c, l);
}}});
let chat, plain;
const clean = h => DOMPurify.sanitize(h);
const md = t => { try { chat ||= make(true); return clean(chat.parse(fix(t))); } catch { return '<p style="white-space:pre-wrap">' + esc(t) + '</p>'; } };
const rich = t => { try { plain ||= make(false); t = fix(t); return clean(/```|\n/.test(t) ? plain.parse(t) : plain.parseInline(t)); } catch { return esc(t); } };
window.Rich = {md, rich, block};
})();
