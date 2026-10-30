/* Sara AI · Cursos personalizados
   Onboarding -> (1) esquema -> (2) primeras lecciones -> (3+) lecciones progresivas -> ejercicios y repasos.
   Usa globals de script.js: $, esc, md, toast, kv, apiKey, needKey. Reutiliza Tools (flashcards/test) para repasos. */
(() => {
'use strict';
const st = {xp: 0, streak: 0, last: ''};
let C = {}, cc = null, ov, Q = [], n = 0, lesson = null, ok = 0, tot = 0, retry = null, tried = false;
const save = () => kv.set('courses', {C, st});
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w ]/g, '').trim();
const prof = c => `Tema: ${c.p.topic}. Nivel: ${c.p.level}. Tiempo disponible: ${c.p.time}. Objetivo: ${c.p.goal}.`;

// ---------- API (una petición = un JSON corto) ----------
async function ai(sys, user) {
  if (!apiKey) { needKey(); throw Error('Falta la API Key'); }
  for (let t = 0; t < 2; t++) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'HTTP-Referer': location.href, 'X-Title': 'Sara AI App'},
      body: JSON.stringify({model: 'openrouter/auto', temperature: .5, messages: [{role: 'system', content: sys + '\nResponde SOLO con JSON válido en español, sin markdown ni texto extra.'}, {role: 'user', content: user}]})
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error?.message || 'Error ' + r.status);
    const m = (j.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/);
    try { return JSON.parse(m[0]); } catch { }
  }
  throw Error('La IA devolvió un formato inválido. Inténtalo de nuevo.');
}
// Petición 1: estructura completa
async function outline(c) {
  const r = await ai('Eres diseñador instruccional. Creas temarios progresivos y realistas.',
    `${prof(c)}\nDiseña un curso de ~${c.p.size} lecciones agrupadas en módulos, adaptado al perfil. Ordena de lo concreto a lo abstracto: cada lección debe construir sobre la anterior, sin saltos de dificultad, y el último módulo debe llevar al objetivo del alumno.\nFormato: {"title":"","description":"","modules":[{"title":"","lessons":[{"title":"","summary":"máx 12 palabras"}]}]}`);
  c.title = r.title || c.p.topic; c.desc = r.description || '';
  c.lessons = (r.modules || []).flatMap(m => (m.lessons || []).map(l => ({title: String(l.title), summary: String(l.summary || ''), module: String(m.title), done: false, content: null})));
  if (!c.lessons.length) throw Error('No se pudo generar el temario.');
}
// Peticiones 2+: lotes de lecciones (teoría + ejercicios)
const pend = {};
const fixLesson = x => {
  const ex = (x?.exercises || []).map(e => {
    if (!e || !e.q) return null;
    if (e.type === 'tf' && typeof e.answer === 'boolean') return {type: 'choice', q: String(e.q), options: ['Verdadero', 'Falso'], answer: e.answer ? 0 : 1, why: e.why};
    if (e.type === 'fill' && e.answer != null) return {type: 'fill', q: String(e.q), answer: String(e.answer), why: e.why};
    if (Array.isArray(e.options) && e.options.length > 1 && e.answer >= 0 && e.answer < e.options.length) return {type: 'choice', q: String(e.q), options: e.options.map(String), answer: +e.answer, why: e.why};
    return null;
  }).filter(Boolean);
  return x?.theory && ex.length ? {theory: String(x.theory), ex} : null;
};
function gen(c, i, k = 2) {
  const idx = []; for (let j = i; j < c.lessons.length && idx.length < k; j++) if (!c.lessons[j].content) idx.push(j);
  if (!idx.length) return Promise.resolve();
  const key = c.id + idx[0]; if (pend[key]) return pend[key];
  const seen = c.lessons.filter(l => l.done).map(l => l.title).join('; ') || 'ninguna';
  return pend[key] = ai('Eres un profesor real, cercano y apasionado por enseñar, con años de experiencia explicando a personas de todos los niveles. No eres un manual de referencia: enseñas para que el alumno ENTIENDA. Hablas de tú, con calidez, anticipas dudas y nunca das nada por obvio. Primero el porqué y la intuición, luego el cómo, y solo al final la sintaxis o la fórmula. Nunca sueltes listas secas de tipos, definiciones o código sin explicarlos.',
    `${prof(c)}\nCurso: ${c.title}. Lecciones ya vistas: ${seen}.\nEscribe estas lecciones, en orden, conectando cada una con lo anterior:\n${idx.map(j => `${j + 1}. ${c.lessons[j].title}: ${c.lessons[j].summary}`).join('\n')}\n\nFormato: {"lessons":[{"theory":"...","exercises":[5 o 6 ejercicios]}]}\n\n"theory" es markdown de 500 a 800 palabras con EXACTAMENTE esta estructura:\n## ¿Por qué importa? (el problema real que resuelve este tema y qué pasaría sin él)\n## La idea, con una analogía (una analogía cotidiana clara, desarrollada en varias frases)\n## Paso a paso (el concepto desglosado en pasos numerados; define cada término nuevo la primera vez que aparece y explica el porqué de cada paso)\n## Ejemplo comentado (si aplica, un ejemplo de código en bloque con triple acento grave y el lenguaje; ANTES de mostrarlo di qué vamos a lograr, y DESPUÉS explica línea por línea qué hace y por qué)\n## Errores típicos (2 o 3 confusiones frecuentes y cómo evitarlas)\n## En resumen (3 ideas clave)\nAdapta la profundidad y el vocabulario al nivel del alumno. En el JSON escapa los saltos de línea como \\n y las comillas dobles internas.\n\nLos ejercicios deben comprobar COMPRENSIÓN (el porqué, predecir resultados, detectar errores, elegir la mejor solución), no memorizar sintaxis. En "why" explica el razonamiento como lo haría un profesor, no solo la respuesta. Mezcla tipos:\n{"type":"choice","q":"","options":["","","",""],"answer":0,"why":""} | {"type":"tf","q":"afirmación","answer":true,"why":""} | {"type":"fill","q":"Frase con ___","answer":"palabra","why":""}`)
    .then(r => { idx.forEach((j, q) => { const x = fixLesson(r.lessons?.[q]); if (x) c.lessons[j].content = x; }); save(); if (!c.lessons[idx[0]].content) throw Error('Respuesta incompleta'); })
    .finally(() => delete pend[key]);
}
// Repaso (quiz o flashcards) reutilizando los widgets de tools.js
async function review(kind) {
  const c = cc, d = c.lessons.filter(l => l.done).slice(-4), src = d.length ? d : c.lessons.filter(l => l.content).slice(0, 2);
  if (!src.length) return toast('Completa una lección primero');
  busy('Creando tu repaso a medida…');
  retry = () => review(kind);
  try {
    const f = kind === 'test' ? '{"tool":"test","title":"","questions":[6 de {"type":"choice","q":"","options":["","","",""],"answer":0,"explanation":""}]}' : '{"tool":"flashcards","title":"","cards":[8 de {"front":"","back":""}]}';
    const r = await ai('Eres un profesor experto.', `${prof(c)}\nCrea un repaso de: ${src.map(l => l.title).join('; ')}.\nFormato: ${f}`);
    r.tool = kind; const html = window.Tools && Tools.placeholder(JSON.stringify(r)); if (!html) throw Error('Repaso inválido');
    ov.innerHTML = bar('home') + `<div class="cv-b">${html}</div><div class="cv-f"><button class="btn pri" data-a="home">Volver al curso</button></div>`;
    Tools.mount(ov);
  } catch (e) { fail(e.message); }
}

// ---------- Vistas ----------
const bar = (a, pct = 0) => `<div class="cv-h"><button class="ib" data-a="${a}" aria-label="Salir">✕</button><div class="cv-p"><i style="width:${pct}%"></i></div><span class="cv-st">🔥 ${st.streak} · ⭐ ${st.xp}</span></div>`;
let lt = 0;
function busy(m, steps = [m], i = 0) {
  clearInterval(lt);
  const N = steps.length, cap = (i + 1) / N * 100 - 4; let p = i / N * 100;
  const top = `<div class="spin sm"></div><div class="ld-t"><b>${esc(steps[i])}</b>${N > 1 ? `<small>Paso ${i + 1} de ${N}</small>` : ''}</div><span id="ldP">${Math.round(p)}%</span>`;
  const ul = N > 1 ? steps.map((x, k) => `<li class="${k < i ? 'd' : k === i ? 'c' : ''}">${esc(x)}</li>`).join('') : '';
  if (ov.querySelector('.cv-ld')) { ov.querySelector('.ld-top').innerHTML = top; ov.querySelector('.ld-st').innerHTML = ul; }
  else {
    ov.innerHTML = bar(cc?.lessons.length ? 'home' : 'close') + `<div class="cv-b cv-ld"><div class="ld-top">${top}</div><div class="ld-bar"><i id="ldB"></i></div><ul class="ld-st">${ul}</ul><p class="tag">Mientras la IA trabaja, ¡juega al Pong! <small>(mouse, dedo o ↑ ↓)</small></p><canvas id="pong"></canvas></div>`;
    pong($('#pong'));
  }
  $('#ldB').style.width = p + '%';
  lt = setInterval(() => { const b = $('#ldB'); if (!b) return clearInterval(lt); p += (cap - p) * .04; b.style.width = p + '%'; $('#ldP').textContent = Math.round(p) + '%'; }, 250);
}
function pong(cv) {
  const x = cv.getContext('2d'), W = cv.width = 480, H = cv.height = 270, pw = 8, ph = 56, cl = (v, a, b) => Math.max(a, Math.min(b, v));
  let py = H / 2 - ph / 2, ay = py, bx, by, vx, vy, ps = 0, as = 0, k = 0, rid = 0;
  const rs = d => { bx = W / 2; by = H / 2; vx = d * 4; vy = (Math.random() * 2 - 1) * 3; };
  const mv = e => { const r = cv.getBoundingClientRect(); py = cl((e.clientY - r.top) / r.height * H - ph / 2, 0, H - ph); };
  const kd = e => { if (e.key === 'ArrowUp') k = -1; else if (e.key === 'ArrowDown') k = 1; else return; e.preventDefault(); }, ku = () => k = 0;
  cv.onpointermove = mv; cv.onpointerdown = mv; addEventListener('keydown', kd); addEventListener('keyup', ku); rs(1);
  (function f() {
    if (!cv.isConnected) { removeEventListener('keydown', kd); removeEventListener('keyup', ku); return; }
    py = cl(py + k * 6, 0, H - ph); bx += vx; by += vy;
    if (by < 4 || by > H - 4) vy *= -1;
    ay = cl(ay + cl(by - ph / 2 - ay, -3.3, 3.3), 0, H - ph);
    if (vx < 0 && bx < 14 + pw && bx > 8 && by > py && by < py + ph) { vx = Math.min(9, Math.abs(vx) * 1.06); vy = cl(vy + (by - py - ph / 2) / ph * 5, -6, 6); }
    if (vx > 0 && bx > W - 14 - pw && bx < W - 8 && by > ay && by < ay + ph) { vx = -Math.min(9, Math.abs(vx) * 1.06); vy = cl(vy + (by - ay - ph / 2) / ph * 5, -6, 6); }
    if (bx < 0) { as++; rs(1); } else if (bx > W) { ps++; rs(-1); }
    x.fillStyle = '#15171d'; x.fillRect(0, 0, W, H); x.fillStyle = '#262a33';
    for (let y = 6; y < H; y += 22) x.fillRect(W / 2 - 1, y, 2, 12);
    x.fillStyle = '#7c83ff'; x.fillRect(14, py, pw, ph); x.fillStyle = '#e9eaf0'; x.fillRect(W - 14 - pw, ay, pw, ph);
    x.beginPath(); x.arc(bx, by, 6, 0, 7); x.fillStyle = '#fbbf24'; x.fill();
    x.font = 'bold 28px system-ui'; x.textAlign = 'center'; x.fillStyle = '#8b90a0'; x.fillText(ps, W / 2 - 40, 38); x.fillText(as, W / 2 + 40, 38);
    rid = requestAnimationFrame(f);
  })();
}
const fail = m => { ov.innerHTML = bar('home') + `<div class="cv-b cv-mid"><div class="cv-big">⚠️</div><p>${esc(m)}</p><button class="btn pri" data-a="retry">Reintentar</button></div>`; };
const show = () => { ov.hidden = false; };

const QS = [
  {k: 'topic', q: '¿Qué quieres aprender?', ph: 'Ej: Python desde cero'},
  {k: 'level', q: '¿Cuál es tu nivel actual?', o: ['Principiante total', 'Conozco lo básico', 'Intermedio', 'Avanzado']},
  {k: 'time', q: '¿Cuánto tiempo puedes dedicar?', o: ['10 min al día', '30 min al día', '1 hora al día', 'Unas horas por semana']},
  {k: 'goal', q: '¿Cuál es tu objetivo específico?', ph: 'Ej: conseguir mi primer empleo como programador'},
  {k: 'size', q: '¿Qué tan extensa quieres la ruta?', o: ['Corta (~8 lecciones)', 'Media (~16 lecciones)', 'Extensa (~30 lecciones)', 'Maestría (~50 lecciones)']}
];
let ob = {i: 0, a: {}};
function onboard() {
  show(); const s = QS[ob.i];
  ov.innerHTML = bar('close', ob.i / QS.length * 100) + `<div class="cv-b cv-q"><h2>${s.q}</h2>` +
    (s.o ? `<div class="opts">${s.o.map((o, k) => `<button class="opt" data-a="ans" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`
      : `<input id="obIn" class="fld cv-in" placeholder="${esc(s.ph)}" autocomplete="off"><div class="cv-f2"><button class="btn pri" data-a="ans">Continuar</button></div>`) + `</div>`;
  $('#obIn')?.focus();
}
async function create() {
  const a = ob.a, c = {id: 'c_' + Date.now(), p: {topic: a.topic, level: a.level, time: a.time, goal: a.goal, size: +(a.size.match(/\d+/) || [12])[0]}, lessons: []};
  cc = c; retry = create;
  try {
    const S = ['Diseñando el temario a tu medida', 'Escribiendo tus primeras lecciones'];
    busy('', S, 0); await outline(c);
    busy('', S, 1); await gen(c, 0, 2);
    C[c.id] = c; save(); list(); home();
  } catch (e) { fail(e.message); }
}
function home() {
  show(); const c = cc, d = c.lessons.filter(l => l.done).length, cur = c.lessons.findIndex(l => !l.done);
  let last = '', path = c.lessons.map((l, i) => {
    const s = l.done ? 'done' : i === cur ? 'cur' : 'lock', h = l.module !== last ? `<div class="cv-mod">${esc(l.module)}</div>` : ''; last = l.module;
    return h + `<button class="node ${s}" data-a="les" data-i="${i}" style="--o:${Math.sin(i * 1.1) * 38}px"><span>${l.done ? '✓' : i === cur ? '▶' : '🔒'}</span><em>${esc(l.title)}</em></button>`;
  }).join('');
  ov.innerHTML = bar('close', d / c.lessons.length * 100) +
    `<div class="cv-b"><div class="cv-hero"><h2>${esc(c.title)}</h2><p>${esc(c.desc)}</p><small>${d} / ${c.lessons.length} lecciones · ${Math.round(d / c.lessons.length * 100)}%</small></div><div class="path">${path}</div></div>` +
    `<div class="cv-f"><button class="btn" data-a="prac">🏋️ Practicar / Repasar</button>${cur >= 0 ? `<button class="btn pri" data-a="les" data-i="${cur}">${d ? 'Continuar' : 'Empezar'}</button>` : ''}</div>`;
}
function practice() {
  ov.innerHTML = bar('home') + `<div class="cv-b cv-q"><h2>¿Cómo quieres practicar?</h2><div class="opts"><button class="opt" data-a="rv" data-k="test">📝 Ensayo de práctica (quiz)</button><button class="opt" data-a="rv" data-k="flashcards">🗂️ Tarjetas de memoria</button></div></div>`;
}
async function play(i) {
  const c = cc, l = c.lessons[i];
  if (i > c.lessons.findIndex(x => !x.done) && !l.done) return toast('Completa las lecciones anteriores');
  retry = () => play(i);
  if (!l.content) { busy('Redactando la explicación y los ejercicios…'); try { await gen(c, i, 2); } catch (e) { return fail(e.message); } }
  gen(c, i + 1, 2).catch(() => { }); // generación progresiva en segundo plano
  lesson = l; Q = [{th: 1}, ...l.content.ex.map(e => ({...e}))]; n = 0; ok = 0; tot = l.content.ex.length; step();
}
function step() {
  if (n >= Q.length) return fin();
  const e = Q[n], pct = n / Q.length * 100;
  if (e.th) { ov.innerHTML = bar('home', pct) + `<div class="cv-b"><div class="tag">Lección · ${esc(lesson.title)}</div><div class="a"><div class="b">${md(lesson.content.theory)}</div></div></div><div class="cv-f"><button class="btn pri" data-a="nx">Entendido</button></div>`; return; }
  tried = false;
  ov.innerHTML = bar('home', pct) + `<div class="cv-b cv-q"><div class="tag">${e.retry ? 'Inténtalo otra vez' : 'Ejercicio'}</div><h2>${esc(e.q)}</h2>` +
    (e.type === 'fill' ? `<input id="exIn" class="fld cv-in" placeholder="Escribe tu respuesta…" autocomplete="off" autocapitalize="off">`
      : `<div class="opts">${e.options.map((o, k) => `<button class="opt" data-a="pk" data-k="${k}">${esc(o)}</button>`).join('')}</div>`) +
    `</div><div class="cv-f"><button class="btn pri" data-a="chk" disabled>Comprobar</button></div>`;
  $('#exIn')?.focus();
}
function check() {
  const e = Q[n]; let good, pick = ov.querySelector('.opt.sel'), inp = $('#exIn');
  if (e.type === 'fill') good = norm(inp.value) === norm(e.answer); else good = +pick.dataset.k === e.answer;
  if (good && !e.retry) ok++;
  if (!good && !e.retry) Q.push({...e, retry: 1});
  ov.querySelectorAll('.opt').forEach((o, k) => { o.disabled = true; if (k === e.answer) o.classList.add('good'); else if (o === pick) o.classList.add('bad'); });
  if (inp) { inp.disabled = true; inp.classList.add(good ? 'good' : 'bad'); }
  const ans = good ? '' : `<p>Respuesta: <b>${esc(e.type === 'fill' ? e.answer : e.options[e.answer])}</b></p>`;
  ov.querySelector('.cv-f').outerHTML = `<div class="cv-f fb ${good ? 'ok' : 'no'}"><div class="cv-fb"><b>${good ? '✅ ¡Correcto!' : '❌ Incorrecto'}</b>${ans}${e.why ? `<p>${esc(e.why)}</p>` : ''}</div><button class="btn pri" data-a="nx">Continuar</button></div>`;
}
function fin() {
  const l = lesson, first = !l.done, gain = first ? 20 + ok * 5 : 5, t = new Date().toDateString(), y = new Date(Date.now() - 864e5).toDateString();
  l.done = true; st.xp += gain; if (st.last !== t) { st.streak = st.last === y ? st.streak + 1 : 1; st.last = t; } save(); list();
  const d = cc.lessons.filter(x => x.done).length, nx = cc.lessons.findIndex(x => !x.done), all = nx < 0;
  ov.innerHTML = bar('home', 100) + `<div class="cv-b cv-mid"><div class="cv-big">${all ? '🏆' : '🎉'}</div><h2>${all ? '¡Curso completado!' : '¡Lección completada!'}</h2><p>+${gain} XP · ${ok}/${tot} a la primera</p>${d % 3 === 0 || all ? `<p class="tag">Buen momento para reforzar lo aprendido</p><button class="btn pri" data-a="rv" data-k="${(d / 3) % 2 ? 'flashcards' : 'test'}">⚡ Repaso de refuerzo</button>` : ''}${all ? '' : `<button class="btn ${d % 3 ? 'pri' : ''}" data-a="les" data-i="${nx}">Siguiente lección</button>`}<button class="btn" data-a="home">Ver ruta</button></div>`;
}

// ---------- Lista lateral y eventos ----------
function list() {
  const el = $('#clist'); if (!el) return;
  el.innerHTML = Object.values(C).reverse().map(c => { const d = c.lessons.filter(l => l.done).length; return `<div class="it" data-c="${c.id}"><span class="t">🎓 ${esc(c.title)} · ${Math.round(d / c.lessons.length * 100)}%</span><button data-x="${c.id}" title="Eliminar"><svg class="i" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button></div>`; }).join('');
}
function init() {
  ov = document.createElement('div'); ov.id = 'cv'; ov.hidden = true; document.body.append(ov);
  $('.tabs').insertAdjacentHTML('beforebegin', '<button id="cNew" class="btn pri">🎓 Crear curso</button><div id="clist"></div>');
  $('#cNew').onclick = () => { ob = {i: 0, a: {}}; document.body.classList.remove('open'); onboard(); };
  $('#clist').onclick = e => {
    const x = e.target.closest('[data-x]');
    if (x) { if (confirm('¿Eliminar este curso?')) { delete C[x.dataset.x]; save(); list(); } return; }
    const it = e.target.closest('[data-c]'); if (it) { cc = C[it.dataset.c]; document.body.classList.remove('open'); home(); }
  };
  const A = {
    close: () => { ov.hidden = true; list(); }, home: () => home(), retry: () => retry && retry(), prac: practice,
    ans: t => { const s = QS[ob.i], v = t.dataset.v ?? $('#obIn').value.trim(); if (!v) return toast('Escribe una respuesta'); ob.a[s.k] = v; ++ob.i < QS.length ? onboard() : create(); },
    les: t => play(+t.dataset.i), rv: t => review(t.dataset.k), nx: () => { n++; step(); },
    pk: t => { ov.querySelectorAll('.opt').forEach(o => o.classList.toggle('sel', o === t)); ov.querySelector('[data-a=chk]').disabled = false; },
    chk: check
  };
  ov.onclick = e => { const t = e.target.closest('[data-a]'); if (t && !t.disabled) A[t.dataset.a]?.(t); };
  ov.oninput = e => { if (e.target.id === 'exIn') ov.querySelector('[data-a=chk]').disabled = !e.target.value.trim(); };
  ov.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('.cv-in')) { e.preventDefault(); (ov.querySelector('[data-a=chk]:not(:disabled)') || ov.querySelector('.cv-f2 [data-a=ans]'))?.click(); } };
  kv.get('courses').then(d => { if (d) { C = d.C || {}; Object.assign(st, d.st); } list(); });
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
