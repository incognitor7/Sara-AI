/* Sara AI · Cuadernos de estudio
   Un cuaderno es un chat (type:'notebook') con fuentes propias. Los textos se guardan en IndexedDB ('nbsrc_<id>').
   Contexto: si el material cabe, se envía entero; si no, se eligen los fragmentos más relevantes (BM25) o repartidos. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const GOALS = {libro: ['📖', 'Repasar un libro'], examen: ['🎯', 'Preparar un examen'], oficial: ['🏛️', 'Prueba oficial / oposición'], libre: ['🧠', 'Estudio libre']};
const ACTS = [
  ['📝', 'Resumen', 'Haz un resumen estructurado de todo el material del cuaderno, con los puntos clave.'],
  ['🧭', 'Guía de estudio', 'Crea una guía de estudio de todo el material: conceptos clave, definiciones y ejemplos.'],
  ['✅', 'Test', 'Hazme un test de 8 preguntas de opción múltiple sobre todo el material para practicar.'],
  ['🗂️', 'Flashcards', 'Crea tarjetas de memoria (flashcards) con lo más importante de todo el material.'],
  ['🎙️', 'Podcast', 'Crea un podcast a dos voces que explique lo más importante de todo el material.']];
const OKX = /\.(txt|md|markdown|csv|tsv|json|xml|html?|tex|log|ya?ml|py|js|ts|java|c|cpp|cs|go|rs|php|sql|sh)$/i;
const NO = /^(image|video|audio)\/|\.(png|jpe?g|gif|webp|bmp|svg|heic|tiff?|ico|mp[34]|m4a|wav|ogg|flac|aac|webm|mov|avi|mkv)$/i;
const SRC = {}, CK = {}, MAXC = 3e6, BUD = 4e4;
let bar, empty, fi, dlg, pend = [];
const nb = c => c.nb ||= {goal: 'libre', icon: '📓', src: []};
const kb = n => n >= 1e3 ? Math.round(n / 1e3) + 'k' : n;
const srcs = async id => SRC[id] ||= (await kv.get('nbsrc_' + id)) || [];

// ---------- Lectura de archivos ----------
const lib = u => new Promise((ok, no) => { const s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = () => no(Error('No se pudo cargar el lector de archivos')); document.head.append(s); });
async function pdf(f) {
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  if (!window.pdfjsLib) { await lib(base + 'pdf.min.js'); pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(await (await fetch(base + 'pdf.worker.min.js')).blob()); }
  const d = await pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise, o = [];
  for (let i = 1; i <= d.numPages; i++) o.push((await (await d.getPage(i)).getTextContent()).items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join(''));
  return {text: o.join('\n\n'), pages: d.numPages};
}
async function read(f) {
  const n = f.name; let t, pages;
  if (NO.test(f.type) || NO.test(n)) throw Error('«' + n + '»: no se admiten imágenes, vídeos ni audios');
  if (f.size > 30e6) throw Error('«' + n + '» supera los 30 MB');
  if (/\.pdf$/i.test(n) || f.type === 'application/pdf') ({text: t, pages} = await pdf(f));
  else if (/\.docx$/i.test(n)) { if (!window.mammoth) await lib('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'); t = (await mammoth.extractRawText({arrayBuffer: await f.arrayBuffer()})).value; }
  else if (f.type.startsWith('text/') || f.type === 'application/json' || OKX.test(n)) { t = await f.text(); if (/\.html?$/i.test(n)) t = new DOMParser().parseFromString(t, 'text/html').body.textContent; }
  else throw Error('«' + n + '»: formato no compatible (usa PDF, DOCX, TXT, MD, CSV…)');
  t = t.replace(/\r/g, '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length < 30) throw Error('«' + n + '» no tiene texto legible (¿PDF escaneado?)');
  return {text: t, pages};
}
async function add(c, files) {
  const list = await srcs(c.id), m = nb(c); let n = 0;
  for (const f of files) {
    try {
      toast('Leyendo «' + f.name + '»…'); const {text, pages} = await read(f);
      if (list.reduce((a, s) => a + s.text.length, 0) + text.length > MAXC) throw Error('El cuaderno alcanzó su límite de texto');
      const id = 's' + Date.now().toString(36) + n++; list.push({id, name: f.name, text}); m.src.push({id, name: f.name, chars: text.length, pages});
    } catch (e) { toast(e.message); }
  }
  await kv.set('nbsrc_' + c.id, list); await persist(c); if (n) toast(n + ' fuente(s) añadida(s)'); sync();
}

// ---------- Contexto para la IA ----------
const toks = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9ñ]{3,}/g) || [];
function chunks(s) {
  if (CK[s.id]) return CK[s.id]; const out = []; let cur = '';
  for (const p of s.text.split(/\n{2,}/)) {
    if (cur && cur.length + p.length > 1500) { out.push(cur); cur = ''; }
    if (p.length > 1800) for (let i = 0; i < p.length; i += 1500) out.push(p.slice(i, i + 1500)); else cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) out.push(cur);
  return CK[s.id] = out.map((t, i) => { const tf = new Map(); toks(t).forEach(w => tf.set(w, (tf.get(w) || 0) + 1)); return {s: s.name, i, t, tf}; });
}
async function ctx(c, q) {
  if (c.type !== 'notebook') return '';
  const m = nb(c), list = await srcs(c.id);
  const head = `Estás en un CUADERNO DE ESTUDIO «${c.title}» (objetivo: ${GOALS[m.goal]?.[1] || 'estudio'}). Eres un tutor: basa tus respuestas en las FUENTES del alumno y cítalas como [nombre de la fuente]. Si algo no está en las fuentes, dilo y complementa indicando que es conocimiento general. No inventes datos del material.`;
  if (!list.length) return head + '\nEl alumno aún no ha subido fuentes: ayúdale y anímale a añadirlas.';
  const all = list.flatMap(chunks); let pick = all;
  if (all.reduce((a, x) => a + x.t.length, 0) > BUD) {
    const qq = q + ' ' + c.messages.filter(x => x.role === 'user').slice(-2, -1).map(x => x.content).join(' '), qt = [...new Set(toks(qq))];
    const spread = () => { const k = Math.floor(BUD / 1500); return Array.from({length: k}, (_, i) => all[Math.floor(i * all.length / k)]); };
    if (/todo el material|todas las fuentes|todo el cuaderno/i.test(q) || qt.length < 2) pick = spread();
    else {
      const df = new Map(); all.forEach(x => x.tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)));
      const sc = x => qt.reduce((a, w) => { const f = x.tf.get(w); return f ? a + Math.log(1 + (all.length - df.get(w) + .5) / (df.get(w) + .5)) * f * 2.2 / (f + 1.2) : a; }, 0);
      let used = 0; pick = [];
      for (const [s, x] of all.map(x => [sc(x), x]).sort((a, b) => b[0] - a[0])) { if (!s || used + x.t.length > BUD) continue; pick.push(x); used += x.t.length; }
      if (!pick.length) pick = spread();
    }
    pick = [...new Set(pick)].sort((a, b) => all.indexOf(a) - all.indexOf(b));
  }
  return head + (pick.length < all.length ? '\n(Material extenso: se incluyen solo los fragmentos más relevantes.)' : '') + '\n\nFUENTES:\n' + pick.map(x => `### [${x.s} · fragmento ${x.i + 1}]\n${x.t}`).join('\n\n');
}

// ---------- Interfaz ----------
function sync() {
  const c = chats[cur], is = c && c.type === 'notebook', e = mode === 'notebook' && !c;
  empty.hidden = !e; if (e) { $('#empty').hidden = true; $('#msgs').hidden = true; }
  bar.hidden = !is; if (is) draw(c);
}
function draw(c) {
  const m = nb(c), n = m.src.reduce((a, s) => a + s.chars, 0);
  bar.innerHTML = `<div class="nb-t"><span>${esc(GOALS[m.goal]?.[1] || 'Estudio')} · ${m.src.length} fuente${m.src.length === 1 ? '' : 's'}${n ? ' · ' + kb(n) + ' caracteres' : ''}</span><button data-nb="add">＋ Añadir fuentes</button></div>` +
    (m.src.length ? `<div class="nb-s">${m.src.map((s, i) => `<span class="nb-c" title="${esc(s.name)}">${/\.pdf$/i.test(s.name) ? '📕' : '📄'} ${esc(s.name)}${s.pages ? ' · ' + s.pages + ' pág.' : ''}<button data-nb="rm" data-i="${i}" aria-label="Quitar fuente">✕</button></span>`).join('')}</div>` : '<p class="nb-h">Sube PDFs o apuntes para que la IA estudie contigo con tu propio material.</p>') +
    `<div class="nb-a">${ACTS.map((a, i) => `<button data-nb="act" data-i="${i}">${a[0]} ${a[1]}</button>`).join('')}</div>`;
}
const plist = () => $('#nbL').innerHTML = pend.map((f, i) => `<span class="nb-c">📄 ${esc(f.name)}<button type="button" data-nb="pr" data-i="${i}" aria-label="Quitar">✕</button></span>`).join('');
async function make() {
  const g = $('#nbG').value, t = Date.now(), id = 'chat_' + t, name = $('#nbN').value.trim() || 'Cuaderno sin título';
  const c = chats[id] = {id, fileName: `chat_${t}.json`, title: GOALS[g][0] + ' ' + name, type: 'notebook', assistantId: $('#ast').value || 'profesor_educativo', createdAt: new Date().toISOString(), messages: [], nb: {goal: g, icon: GOALS[g][0], src: []}};
  dlg.close(); const fs = pend.splice(0); await persist(c); open(id); if (fs.length) await add(c, fs);
}
function init() {
  bar = document.createElement('div'); bar.id = 'nbBar'; bar.hidden = true; $('#msgs').before(bar);
  empty = document.createElement('div'); empty.id = 'nbEmpty'; empty.hidden = true;
  empty.innerHTML = '<div class="logo">📓</div><h2>Tus cuadernos de estudio</h2><p>Sube tus apuntes, libros o temarios y estudia con una IA que se apoya en tu material.</p><button class="btn pri" data-nb="new">＋ Nuevo cuaderno</button><div class="nbx"><span>📖 Repasar un libro para un examen</span><span>🏛️ Preparar una prueba oficial</span><span>🗂️ Convertir PDFs en tests y flashcards</span></div>';
  $('#empty').before(empty);
  fi = document.createElement('input'); fi.type = 'file'; fi.multiple = true; fi.hidden = true;
  fi.accept = '.pdf,.docx,.txt,.md,.csv,.json,.html,.xml,.tex,.yml,.yaml,.py,.js,.ts,.java,.c,.cpp,.cs,.go,.rs,.php,.sql,text/*,application/pdf'; document.body.append(fi);
  dlg = document.createElement('dialog'); dlg.id = 'dNb';
  dlg.innerHTML = `<h3>📓 Nuevo cuaderno</h3><div class="nbf"><label for="nbN">Nombre</label><input id="nbN" class="fld" placeholder="Ej: Biología · examen final" autocomplete="off"></div><div class="nbf"><label for="nbG">¿Para qué lo usarás?</label><select id="nbG" class="fld">${Object.entries(GOALS).map(([k, v]) => `<option value="${k}">${v[0]} ${v[1]}</option>`).join('')}</select></div><div class="nbf"><label>Fuentes · PDF, DOCX, TXT, MD, CSV… (sin imágenes, vídeo ni audio)</label><button type="button" class="btn" data-nb="pick">📎 Elegir archivos</button><div id="nbL" class="nb-s wrap"></div></div><div class="row"><button class="btn" data-close>Cancelar</button><button class="btn pri" data-nb="make">Crear cuaderno</button></div>`;
  document.body.append(dlg);
  fi.onchange = () => { const fs = [...fi.files]; fi.value = ''; if (dlg.open) { pend.push(...fs); plist(); } else if (chats[cur]) add(chats[cur], fs); };
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-nb]'); if (!b) return; const k = b.dataset.nb, c = chats[cur], i = +b.dataset.i;
    if (k === 'new') { pend = []; plist(); $('#nbN').value = ''; dlg.showModal(); $('#nbN').focus(); }
    else if (k === 'pick' || k === 'add') fi.click();
    else if (k === 'pr') { pend.splice(i, 1); plist(); }
    else if (k === 'make') make();
    else if (k === 'act') send(ACTS[i][2]);
    else if (k === 'rm' && c) {
      const s = nb(c).src[i]; if (!s || !confirm('¿Quitar «' + s.name + '» del cuaderno?')) return;
      nb(c).src.splice(i, 1); const l = await srcs(c.id), j = l.findIndex(x => x.id === s.id); if (j >= 0) l.splice(j, 1);
      delete CK[s.id]; await kv.set('nbsrc_' + c.id, l); persist(c); sync();
    }
  });
}
init();
window.NB = {sync, ctx, drop: id => { kv.del('nbsrc_' + id); delete SRC[id]; }};
})();
