/* Sara AI · Herramientas interactivas v2
   Bloques ```json con {"tool": "flashcards" | "podcast" | "test"} -> widgets.
   Conexión con script.js: Tools.placeholder(), Tools.mount(), Tools.prompt(). */
(() => {
'use strict';
const TOOLS = {
  test: {ic: '📝', label: 'Examen / test'},
  flashcards: {ic: '🗂️', label: 'Tarjetas de memoria'},
  podcast: {ic: '🎙️', label: 'Podcast a dos voces'}
};
const BASE = [
  'HERRAMIENTAS INTERACTIVAS. Detecta la intención por el contexto, no por palabras exactas:',
  '- "test": el usuario quiere ser evaluado, practicar o medir lo que sabe (examen, prueba, quiz, cuestionario, "ponme a prueba", "a ver cuánto sé", "evalúame", "practicar").',
  '- "flashcards": quiere memorizar o repasar conceptos (tarjetas, fichas, repaso rápido, "ayúdame a memorizar").',
  '- "podcast": quiere escuchar una explicación como conversación o audio entre dos personas.',
  'En esos casos entrega UN bloque ```json con JSON válido (sin comentarios ni comas finales) y una frase breve fuera del bloque. Formatos:',
  'Test (mezcla opción múltiple, mayoría, y alguna pregunta abierta; "answer" es el índice de la opción correcta empezando en 0): {"tool":"test","title":"Título","questions":[{"type":"choice","q":"Pregunta","options":["A","B","C","D"],"answer":1,"explanation":"Por qué"},{"type":"text","q":"Pregunta abierta"}]}',
  'Flashcards (opcionalmente con "options" y "answer" para elegir la respuesta): {"tool":"flashcards","title":"Título","cards":[{"front":"Pregunta","back":"Respuesta"},{"front":"Pregunta","options":["A","B","C"],"answer":0,"back":"Explicación"}]}',
  'Podcast (exactamente dos personas, español natural, frases cortas, 8 a 16 intervenciones): {"tool":"podcast","title":"Título","dialogue":[{"speaker":"Ana","text":"..."},{"speaker":"Luis","text":"..."}]}',
  'Si el usuario envía respuestas de un test, corrígelas con retroalimentación amable. En cualquier otro caso responde con normalidad, sin JSON.'
].join('\n');

// ---------- utilidades ----------
const $ = s => document.querySelector(s);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const btn = (label, fn, cls = '') => { const b = h('button', 'tbtn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.onclick = fn; return b; };
const str = v => v == null ? '' : String(v).trim();
const arr = v => Array.isArray(v) ? v : [];
const note = m => { if (typeof toast === 'function') toast(m); };
const hash = s => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };
const parse = s => { try { const o = JSON.parse(s); return o && typeof o === 'object' && TOOLS[o.tool] ? o : null; } catch { return null; } };
const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { } };
const load = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const meter = (g, r) => { const m = h('div', 'meter'), a = h('i', 'g'), b = h('i', 'r'); const t = (g + r) || 1; a.style.width = g / t * 100 + '%'; b.style.width = r / t * 100 + '%'; m.append(a, b); return m; };
const fsBtn = root => {
  const b = btn('⛶', () => { const on = root.classList.toggle('full'); b.textContent = on ? '✕' : '⛶'; b.title = on ? 'Salir de pantalla completa' : 'Pantalla completa'; b.setAttribute('aria-label', b.title); }, 'sm');
  b.title = 'Pantalla completa'; b.setAttribute('aria-label', b.title); root._fs = b; return b;
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const r = document.querySelector('.tool.full'); if (r && r._fs) r._fs.click(); } });

// ---------- normalización ----------
const ansIdx = (a, opts) => {
  if (typeof a === 'number') return a;
  const s = str(a); if (/^\d+$/.test(s)) return +s;
  if (/^[a-f]$/i.test(s)) return s.toLowerCase().charCodeAt(0) - 97;
  return opts.findIndex(o => o.toLowerCase() === s.toLowerCase());
};
const choice = c => {
  const opts = arr(c?.options || c?.opciones).map(str).filter(Boolean);
  const ans = ansIdx(c?.answer ?? c?.respuesta_correcta ?? c?.correct ?? c?.correcta, opts);
  return opts.length >= 2 && ans >= 0 && ans < opts.length ? {opts, ans} : {};
};
const NORM = {
  flashcards: o => {
    const cards = arr(o.cards || o.tarjetas).map(c => {
      const ch = choice(c), front = str(c?.front ?? c?.q ?? c?.pregunta ?? c?.frente);
      const back = str(c?.back ?? c?.a ?? c?.respuesta ?? c?.reverso ?? c?.explanation) || (ch.opts ? ch.opts[ch.ans] : '');
      return {front, back, ...ch};
    }).filter(c => c.front && c.back);
    return cards.length ? {title: str(o.title || o.titulo) || 'Tarjetas de memoria', cards} : null;
  },
  podcast: o => {
    const lines = arr(o.dialogue || o.dialogo || o.lines).map((l, i) => ({
      speaker: str(l?.speaker ?? l?.voz ?? l?.hablante) || 'Voz ' + (i % 2 + 1), text: str(l?.text ?? l?.texto)
    })).filter(l => l.text);
    return lines.length ? {title: str(o.title || o.titulo) || 'Podcast', lines} : null;
  },
  test: o => {
    const qs = arr(o.questions || o.preguntas).map(q => {
      if (typeof q !== 'object' || !q) return {q: str(q)};
      return {q: str(q.q ?? q.question ?? q.pregunta), why: str(q.explanation ?? q.explicacion ?? q.explicación), ...choice(q)};
    }).filter(q => q.q);
    return qs.length ? {title: str(o.title || o.titulo) || 'Test', questions: qs} : null;
  }
};

// ---------- 1. Flashcards ----------
function flashcards(root, d) {
  let deck = d.cards.slice(), i = 0, ok = 0, bad = 0, wrong = [], graded = false;
  const head = h('div', 'tl-h'), prog = h('div', 'tl-prog'), fill = h('i'), stage = h('div', 'fc-stage');
  head.append(h('span', '', '🗂️ ' + d.title), fsBtn(root)); prog.append(fill); root.append(head, prog, stage);

  const start = cards => { deck = cards; i = 0; ok = bad = 0; wrong = []; card(); };
  const grade = good => { if (graded) return; graded = true; if (good) ok++; else { bad++; wrong.push(deck[i]); } };
  const next = () => { i++; i < deck.length ? card() : summary(); };

  function card() {
    graded = false; const c = deck[i]; stage.innerHTML = ''; fill.style.width = i / deck.length * 100 + '%';
    const fc = h('div', 'fc'), inner = h('div', 'fc-in'), f = h('div', 'fc-f'), b = h('div', 'fc-f fc-b'), bar = h('div', 'tl-bar');
    f.dataset.l = 'Pregunta'; b.dataset.l = 'Respuesta';
    f.append(h('div', 'fc-x', c.front)); b.append(h('div', 'fc-x', c.back)); inner.append(f, b); fc.append(inner);
    stage.append(h('div', 'tl-c', (i + 1) + ' / ' + deck.length + '  ·  ✅ ' + ok + '  ·  ❌ ' + bad), fc);
    let shown = false;
    const rate = () => bar.append(btn('❌ No la sabía', () => { grade(false); next(); }, 'bad'), btn('✅ La sabía', () => { grade(true); next(); }, 'good'));
    if (c.opts) {
      const ol = h('div', 'opts');
      c.opts.forEach((o, k) => ol.append(btn(o, () => {
        if (graded) return; grade(k === c.ans);
        [...ol.children].forEach((x, m) => { x.disabled = true; if (m === c.ans) x.classList.add('good'); else if (m === k) x.classList.add('bad'); });
        fc.classList.add('flip'); bar.append(btn(i + 1 < deck.length ? 'Siguiente ›' : 'Ver resultados', next, 'pri'));
      }, 'opt')));
      stage.append(ol, bar);
      fc.onclick = () => { if (graded) fc.classList.toggle('flip'); };
    } else {
      bar.append(btn('Mostrar respuesta', () => reveal(), 'pri')); stage.append(bar);
      const reveal = () => { if (shown) return; shown = true; fc.classList.add('flip'); bar.innerHTML = ''; rate(); };
      fc.onclick = () => shown ? fc.classList.toggle('flip') : reveal();
      bar.firstChild.onclick = reveal;
    }
  }
  function summary() {
    const n = deck.length, pct = Math.round(ok / n * 100); fill.style.width = '100%'; stage.innerHTML = '';
    const bar = h('div', 'tl-bar');
    if (wrong.length) { const w = wrong.slice(); bar.append(btn('Repasar falladas (' + w.length + ')', () => start(w), 'pri')); }
    bar.append(btn('Reiniciar', () => start(d.cards.slice())));
    stage.append(h('div', 'sum-n', pct + '%'), h('div', 'sum-t', 'de aciertos'), meter(ok, bad),
      h('div', 'tl-hint', '✅ ' + ok + ' aciertos (' + pct + '%)  ·  ❌ ' + bad + ' errores (' + (100 - pct) + '%)'), bar);
  }
  card();
}

// ---------- Música de fondo (global) ----------
const Music = (() => {
  let au = null, url = '', name = '', chip, vol, chg;
  const file = h('input'); file.type = 'file'; file.accept = 'audio/*,.mp3'; file.hidden = true;
  const lab = () => { chip.textContent = au ? (au.paused ? '▶ ' : '⏸ ') + name : '🎵 Música'; chip.classList.toggle('on', !!au && !au.paused); vol.hidden = chg.hidden = !au; };
  file.onchange = () => {
    const f = file.files[0]; if (!f) return;
    if (au) au.pause(); if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(f); name = f.name.replace(/\.[^.]+$/, '').slice(0, 18);
    au = new Audio(url); au.loop = true; au.volume = (+vol.value || 12) / 100;
    au.onplay = au.onpause = lab; lab();
    au.play().catch(() => note('Toca el botón de música para reproducir'));
    file.value = '';
  };
  const toggle = () => { if (!au) return file.click(); au.paused ? au.play().catch(() => note('No se pudo reproducir')) : au.pause(); };
  const init = chips => {
    chip = h('button', 'chip', '🎵 Música'); chip.type = 'button'; chip.title = 'Música de fondo (mp3 local)'; chip.onclick = toggle;
    vol = h('input', 'vol'); vol.type = 'range'; vol.min = 0; vol.max = 60; vol.value = 12; vol.title = 'Volumen'; vol.hidden = true;
    vol.oninput = () => { if (au) au.volume = vol.value / 100; };
    chg = h('button', 'chip', 'Cambiar'); chg.type = 'button'; chg.hidden = true; chg.onclick = () => file.click();
    chips.append(chip, vol, chg, file);
  };
  return {init, toggle};
})();

// ---------- 2. Podcast a dos voces ----------
let activePod = null;
function podcast(root, d) {
  const head = h('div', 'tl-h'); head.append(h('span', '', '🎙️ ' + d.title));
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    root.append(head, h('div', 'tl-hint', 'Tu navegador no admite síntesis de voz.')); return;
  }
  const synth = window.speechSynthesis, names = [];
  d.lines.forEach(l => { if (!names.includes(l.speaker)) names.push(l.speaker); });
  const who = l => names.indexOf(l.speaker) % 2;
  let idx = 0, playing = false, gen = 0, rate = 1, tm = 0;
  const cnt = h('span', 'tl-c'); head.append(cnt);

  const list = h('div', 'pc-list'), rows = d.lines.map((l, k) => {
    const r = h('div', 'pc-l s' + who(l)); r.append(h('span', 'pc-s', l.speaker), h('span', 'pc-t', l.text));
    r.onclick = () => { idx = k; jump(k); }; list.append(r); return r;
  });
  const sels = [0, 1].map(s => { const w = h('div'), sel = h('select'); w.append(h('label', '', 'Voz de ' + (names[s] || 'Voz ' + (s + 1))), sel); return {w, sel}; });
  const esVoices = () => synth.getVoices().filter(v => /^es/i.test(v.lang));
  const score = v => (/natural|neural|online|premium|enhanced|google|microsoft/i.test(v.name) ? 4 : 0) + (v.localService ? 0 : 1) + (/^es[-_](es|mx|us|ar|co)/i.test(v.lang) ? 1 : 0);
  const fillVoices = () => {
    const vs = esVoices().sort((a, b) => score(b) - score(a));
    sels.forEach(({sel}) => {
      const prev = sel.value; sel.innerHTML = '';
      const a = h('option', '', vs.length ? 'Automática (mejor disponible)' : 'Voz predeterminada'); a.value = ''; sel.append(a);
      vs.forEach(v => { const o = h('option', '', v.name + ' (' + v.lang + ')'); o.value = v.voiceURI; sel.append(o); });
      if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    });
  };
  const FEM = /female|mujer|helena|sabina|paulina|m[oó]nica|luc[ií]a|elvira|dalia|ximena|marisol|laura|elena|salom[eé]|camila|paloma|sof[ií]a|valentina/i;
  const MAS = /\bmale\b|hombre|jorge|pablo|diego|enrique|[aá]lvaro|ra[uú]l|alonso|carlos|juan|pedro|tom[aá]s|andr[eé]s|gonzalo|jaime/i;
  const pick = () => {
    const vs = esVoices().sort((a, b) => score(b) - score(a)), ch = sels.map(({sel}) => vs.find(v => v.voiceURI === sel.value) || null);
    const a = ch[0] || vs.find(v => FEM.test(v.name)) || vs[0] || null;
    const b = ch[1] || vs.find(v => MAS.test(v.name) && v !== a) || vs.find(v => v !== a) || a;
    return [a, b];
  };
  const onVoices = () => root.isConnected ? fillVoices() : synth.removeEventListener('voiceschanged', onVoices);
  synth.addEventListener('voiceschanged', onVoices); fillVoices();

  const playBtn = btn('▶ Reproducir', () => playing ? halt() : jump(idx), 'pri');
  const rateSel = h('select', 'tl-rate');
  [['0.85', 'Lenta'], ['1', 'Normal'], ['1.15', 'Rápida'], ['1.35', 'Muy rápida']].forEach(([v, t]) => { const o = h('option', '', t + ' ' + v + '×'); o.value = v; rateSel.append(o); });
  rateSel.value = '1'; rateSel.onchange = () => { rate = +rateSel.value || 1; if (playing) jump(idx); };
  const prev = btn('⏮', () => go(idx - 1)), stop = btn('⏹', () => { halt(); idx = 0; mark(); }), nxt = btn('⏭', () => go(idx + 1));
  prev.title = 'Anterior'; stop.title = 'Detener'; nxt.title = 'Siguiente';
  const bar = h('div', 'tl-bar'); bar.append(prev, playBtn, stop, nxt, btn('🎵 Música', () => Music.toggle()), rateSel);
  const vbox = h('div', 'pc-v'); sels.forEach(s => vbox.append(s.w));
  root.append(head, list, bar, vbox, h('div', 'tl-hint', 'Toca una línea para saltar a ella · la música se carga con 🎵'));

  function mark() {
    rows.forEach((r, k) => r.classList.toggle('on', k === idx)); cnt.textContent = (idx + 1) + ' / ' + d.lines.length;
    if (playing) list.scrollTop = Math.max(0, rows[idx].offsetTop - list.clientHeight / 2 + rows[idx].offsetHeight / 2);
  }
  function setPlay() { playBtn.textContent = playing ? '⏸ Pausar' : '▶ Reproducir'; }
  function halt() { gen++; playing = false; clearTimeout(tm); try { synth.cancel(); } catch { } if (activePod === halt) activePod = null; setPlay(); }
  function go(i) { idx = Math.min(Math.max(i, 0), d.lines.length - 1); mark(); if (playing) jump(idx); }
  function jump(i) {
    if (activePod && activePod !== halt) activePod();
    activePod = halt; gen++; clearTimeout(tm); try { synth.cancel(); } catch { }
    playing = true; setPlay(); idx = i; mark(); tm = setTimeout(() => speak(i), 80);
  }
  function speak(i) {
    if (!root.isConnected) return halt();
    if (i >= d.lines.length) { halt(); idx = 0; mark(); return; }
    idx = i; mark();
    const my = ++gen, l = d.lines[i], s = who(l), [va, vb] = pick(), v = s ? vb : va, same = !va || va === vb;
    const u = new SpeechSynthesisUtterance(l.text);
    u.lang = v ? v.lang : 'es-ES'; if (v) u.voice = v;
    u.rate = Math.min(2, Math.max(.5, rate * (s ? .96 : 1.02)));
    u.pitch = Math.min(2, Math.max(.1, (same ? (s ? .78 : 1.2) : (s ? .92 : 1.06)) + (Math.random() - .5) * .08));
    u.onend = () => { if (my === gen && playing) tm = setTimeout(() => { if (my === gen && playing) speak(i + 1); }, 260); };
    u.onerror = () => { if (my === gen && playing) { halt(); note('No se pudo reproducir la voz'); } };
    synth.speak(u);
  }
  mark(); setPlay();
}

// ---------- 3. Test: opción múltiple + respuesta escrita ----------
function test(root, d) {
  const key = 'sara_test_' + hash(JSON.stringify(d));
  const st = d.questions.map((_, k) => Object.assign({s: null, t: ''}, load(key)?.[k]));
  const head = h('div', 'tl-h'), cnt = h('span', 'tl-c'); head.append(h('span', '', '📝 ' + d.title), fsBtn(root)); root.append(head, cnt);
  const save = () => {
    const mc = d.questions.filter(q => q.opts), good = mc.filter(q => st[d.questions.indexOf(q)].s === q.ans).length;
    const bad = mc.filter(q => { const s = st[d.questions.indexOf(q)].s; return s !== null && s !== q.ans; }).length;
    cnt.textContent = (st.filter((s, k) => d.questions[k].opts ? s.s !== null : s.t.trim()).length) + ' / ' + st.length + ' respondidas' + (mc.length ? '  ·  ✅ ' + good + '  ·  ❌ ' + bad : '');
    store(key, st);
  };
  const grow = t => { t.style.height = 'auto'; t.style.height = Math.max(76, t.scrollHeight + 2) + 'px'; };
  const tas = [];
  d.questions.forEach((q, k) => {
    const box = h('div', 'ts-q'); box.append(h('div', 'ts-p', (k + 1) + '. ' + q.q));
    if (q.opts) {
      const ol = h('div', 'opts'), why = h('div', 'why'); why.hidden = true;
      const lock = () => { [...ol.children].forEach((x, m) => { x.disabled = true; if (m === q.ans) x.classList.add('good'); else if (m === st[k].s) x.classList.add('bad'); });
        why.textContent = (st[k].s === q.ans ? '✅ ¡Correcto! ' : '❌ Incorrecto. Respuesta: ' + q.opts[q.ans] + '. ') + (q.why || ''); why.hidden = false; };
      q.opts.forEach((o, m) => ol.append(btn(String.fromCharCode(65 + m) + ') ' + o, () => { if (st[k].s !== null) return; st[k].s = m; lock(); save(); }, 'opt')));
      box.append(ol, why); if (st[k].s !== null) lock();
    } else {
      const t = h('textarea'); t.placeholder = 'Escribe tu respuesta…'; t.value = st[k].t; t.setAttribute('aria-label', 'Respuesta ' + (k + 1));
      t.oninput = () => { st[k].t = t.value; grow(t); save(); }; box.append(t); tas.push(t);
    }
    root.append(box);
  });
  const compose = () => {
    const mc = d.questions.filter(q => q.opts), good = mc.filter(q => st[d.questions.indexOf(q)].s === q.ans).length;
    return 'Mis respuestas al test «' + d.title + '»:\n\n' + d.questions.map((q, k) => (k + 1) + '. ' + q.q + '\nRespuesta: ' +
      (q.opts ? (st[k].s === null ? '(sin responder)' : q.opts[st[k].s]) : (st[k].t.trim() || '(sin responder)'))).join('\n\n') +
      (mc.length ? '\n\nAciertos en opción múltiple: ' + good + '/' + mc.length : '') + '\n\nPor favor, revisa mis respuestas y dame retroalimentación.';
  };
  const answered = () => st.some((s, k) => d.questions[k].opts ? s.s !== null : s.t.trim());
  const bar = h('div', 'tl-bar');
  bar.append(
    btn('Enviar respuestas al chat', () => {
      if (!answered()) return note('Responde al menos una pregunta');
      if (typeof busy !== 'undefined' && busy) return note('Espera a que termine la respuesta actual');
      if (typeof send !== 'function') return note('No se pudo enviar al chat');
      const text = compose(); root.classList.remove('full'); store(key, null); send(text);
    }, 'pri'),
    btn('Copiar', () => navigator.clipboard ? navigator.clipboard.writeText(compose()).then(() => note('Respuestas copiadas'), () => note('No se pudo copiar')) : note('No se pudo copiar')),
    btn('Reiniciar', () => { store(key, null); const f = root.classList.contains('full'); root.innerHTML = ''; test(root, d); root.classList.toggle('full', f); if (f && root._fs) root._fs.textContent = '✕'; })
  );
  root.append(bar); tas.forEach(grow); save();
  if (!answered()) store(key, null);
}

const BUILD = {flashcards, podcast, test};

// ---------- Menú "+" : fuerza el uso de una herramienta ----------
let pending = null, pchip = null;
function setPending(k) {
  pending = k;
  if (!pchip) return;
  pchip.hidden = !k; if (k) pchip.textContent = TOOLS[k].ic + ' ' + TOOLS[k].label + ' ✕';
  const i = $('#inp'); if (i) i.placeholder = k ? 'Escribe el tema para: ' + TOOLS[k].label.toLowerCase() + '…' : 'Escribe tu mensaje…';
}
function initUI() {
  const f = $('#f'), inp = $('#inp'), chips = $('.chips');
  if (!f || !inp || !chips) return;
  const plus = h('button', 'plus', '+'); plus.type = 'button'; plus.title = 'Añadir herramienta'; plus.setAttribute('aria-label', 'Añadir herramienta'); plus.setAttribute('aria-haspopup', 'true');
  const menu = h('div', 'tmenu'); menu.hidden = true;
  Object.entries(TOOLS).forEach(([k, t]) => { const b = h('button', '', t.ic + '  ' + t.label); b.type = 'button'; b.onclick = () => { setPending(k); menu.hidden = true; inp.focus(); }; menu.append(b); });
  f.insertBefore(plus, inp); f.append(menu);
  plus.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  pchip = h('button', 'chip on'); pchip.type = 'button'; pchip.hidden = true; pchip.title = 'Quitar herramienta'; pchip.onclick = () => setPending(null);
  chips.prepend(pchip); Music.init(chips);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI); else initUI();

// ---------- API pública ----------
function placeholder(code) {
  const c = String(code).trim(), o = parse(c);
  return o && NORM[o.tool](o) ? '<div class="tool" data-tool="' + o.tool + '" data-p="' + encodeURIComponent(c) + '"></div>' : '';
}
function mount(el) {
  if (!el) return;
  el.querySelectorAll('.tool[data-p]:not(.ready)').forEach(r => {
    r.classList.add('ready');
    try {
      const o = parse(decodeURIComponent(r.dataset.p)), d = o && NORM[o.tool](o);
      if (!d) throw new Error('Herramienta no válida');
      r.removeAttribute('data-p'); r.innerHTML = ''; BUILD[o.tool](r, d);
    } catch (e) { console.error('Tools:', e); r.textContent = 'No se pudo mostrar esta herramienta.'; }
  });
}
function prompt() {
  let p = BASE;
  if (pending) { p += '\n\nOBLIGATORIO: el usuario eligió la herramienta "' + pending + '". Tu respuesta DEBE incluir el bloque ```json de esa herramienta sobre el tema que pida el usuario, aunque no use la palabra.'; setPending(null); }
  return p;
}
window.Tools = {prompt, placeholder, mount};
})();
