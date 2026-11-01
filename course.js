/* Sara AI · Cursos personalizados
   Onboarding -> (1) esquema -> (2) primeras lecciones -> (3+) lecciones progresivas -> ejercicios y repasos.
   Usa globals de script.js: $, esc, md, toast, kv, apiKey, needKey. Reutiliza Tools (flashcards/test) para repasos. */
(() => {
'use strict';
const st = {xp: 0, streak: 0, best: 0, last: '', days: [], prot: [], hist: {}, acc: {ok: 0, tot: 0}, shields: 0, mute: false};
const PRICE = 50, MAXS = 2;
let C = {}, cc = null, ov, Q = [], n = 0, lesson = null, ok = 0, tot = 0, retry = null, tried = false, playTok = 0;
const save = () => kv.set('courses', {C, st});
const R = t => Rich.rich(t);
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w ]/g, '').trim();
// ---------- Fechas, racha y protectores ----------
const pad = n => String(n).padStart(2, '0');
const dkey = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function mig() { // compatibilidad con datos guardados antes de este cambio
  if (st.last && !/^\d{4}-/.test(st.last)) { const d = new Date(st.last); st.last = isNaN(d) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  st.days = st.days || []; st.prot = st.prot || []; st.hist = st.hist || {}; st.acc = st.acc || {ok: 0, tot: 0}; st.shields = st.shields || 0;
  st.best = Math.max(st.best || 0, st.streak || 0); if (st.last && !st.days.includes(st.last)) st.days.push(st.last);
}
function sync() { // si faltaron días: gasta protectores o rompe la racha
  const t = dkey(), y = dkey(-1); if (!st.streak || !st.last || st.last >= y) return;
  const miss = Math.round((new Date(t + 'T00:00') - new Date(st.last + 'T00:00')) / 864e5) - 1;
  if (st.shields >= miss) { st.shields -= miss; for (let i = miss; i > 0; i--) st.prot.push(dkey(-i)); st.last = y; toast('🛡️ Un protector salvó tu racha'); }
  else st.streak = 0;
  save();
}
function activate() {
  const t = dkey(); if (st.last !== t) { st.streak = st.last === dkey(-1) ? st.streak + 1 : 1; st.last = t; }
  if (!st.days.includes(t)) st.days.push(t); st.best = Math.max(st.best, st.streak); st.hist[t] = (st.hist[t] || 0) + 1;
}
// ---------- Sonidos de recompensa (sintetizados, sin archivos) ----------
let AC;
const SFX = {tap: [[540, 0, .07, 'triangle']], ok: [[660, 0, .12], [880, .09, .12], [1320, .18, .32]], bad: [[240, 0, .16, 'triangle'], [180, .13, .26, 'triangle']],
  done: [[523, 0, .14], [659, .12, .14], [784, .24, .14], [1047, .36, .55]], buy: [[1568, 0, .09, 'triangle'], [2093, .08, .4, 'triangle']]};
function sfx(k) {
  if (st.mute) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume();
    (SFX[k] || []).forEach(([f, t, d, ty]) => { const o = AC.createOscillator(), g = AC.createGain(), s = AC.currentTime + t; o.type = ty || 'sine'; o.frequency.value = f; o.connect(g); g.connect(AC.destination); g.gain.setValueAtTime(.0001, s); g.gain.exponentialRampToValueAtTime(.18, s + .015); g.gain.exponentialRampToValueAtTime(.0001, s + d); o.start(s); o.stop(s + d + .05); });
  } catch { }
}
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
// Petición 1: estructura (curso corto: completa · curso largo: solo la ruta + el primer módulo)
const SHORT = 8;
const PHIL = 'FILOSOFÍA: enseña CONCEPTOS MODULARES y reutilizables, no recetas sueltas. Cada lección explica una idea general (p. ej. "cómo mover cualquier objeto": posición, dirección, velocidad) y solo después la aplica en ejemplos; nunca un caso aislado (p. ej. "el script para mover a este personaje"). Cada lección es un bloque que se apoya en el anterior. Vale para cualquier materia (programación, idiomas, música, ciencias, cocina…). El ÚLTIMO elemento de cada módulo es un PROYECTO PRÁCTICO que integra lo aprendido en ese módulo.';
const ID = 'Eres diseñador instruccional. Creas temarios progresivos y realistas.';
const mk = (l, m, last) => ({title: String(l.title), summary: String(l.summary || ''), module: String(m), project: !!last, done: false, content: null});
async function outline(c) {
  const sz = c.p.size;
  if (sz > SHORT) {
    const r = await ai(ID, `${prof(c)}\n${PHIL}\nDiseña SOLO la ruta de un curso de ~${sz} lecciones en total (cada módulo incluye su proyecto final como última lección). Entrega módulos, no lecciones.\nFormato: {"title":"","description":"","modules":[{"title":"","goal":"máx 15 palabras","lessons":4}]}\nCada módulo tiene entre 3 y 8 lecciones y la suma es ~${sz}. Ordena de lo concreto a lo abstracto; el último módulo lleva al objetivo del alumno.`);
    c.plan = (r.modules || []).filter(m => m && m.title).map(m => ({title: String(m.title), goal: String(m.goal || ''), n: Math.min(8, Math.max(3, +m.lessons || 4)), x: false}));
    if (!c.plan.length) throw Error('No se pudo generar el temario.');
    c.title = r.title || c.p.topic; c.desc = r.description || ''; c.lessons = [];
    return expand(c);
  }
  const r = await ai(ID, `${prof(c)}\n${PHIL}\nDiseña un curso de ~${sz} lecciones en total, agrupadas en módulos (cada módulo termina con su proyecto práctico). Ordena de lo concreto a lo abstracto, sin saltos de dificultad; el último módulo lleva al objetivo del alumno.\nFormato: {"title":"","description":"","modules":[{"title":"","lessons":[{"title":"","summary":"máx 12 palabras"}]}]}`);
  c.title = r.title || c.p.topic; c.desc = r.description || '';
  c.lessons = (r.modules || []).flatMap(m => { const ls = (m.lessons || []).filter(l => l && l.title); return ls.map((l, i) => mk(l, m.title, i === ls.length - 1)); });
  if (!c.lessons.length) throw Error('No se pudo generar el temario.');
}
// Cursos largos: despliega el siguiente módulo de la ruta (sus lecciones), solo cuando toca
async function expand(c) {
  const k = c.plan.findIndex(m => !m.x); if (k < 0) return;
  const m = c.plan[k], seen = c.lessons.map(l => l.title).join('; ') || 'ninguna';
  const r = await ai(ID, `${prof(c)}\n${PHIL}\nCurso: ${c.title}. Ruta: ${c.plan.map((x, j) => (j + 1) + '. ' + x.title).join(' | ')}.\nLecciones ya creadas: ${seen}.\nCrea EXACTAMENTE ${m.n} lecciones del módulo ${k + 1} "${m.title}" (${m.goal}). Cada una construye sobre la anterior y enseña un concepto general; la última es el PROYECTO PRÁCTICO del módulo.\nFormato: {"lessons":[{"title":"","summary":"máx 12 palabras"}]}`);
  const ls = (r.lessons || []).filter(l => l && l.title); if (!ls.length) throw Error('No se pudo generar el módulo.');
  ls.forEach((l, i) => c.lessons.push(mk(l, m.title, i === ls.length - 1))); m.n = ls.length; m.x = true; save();
}
const tl = c => c.lessons.length + (c.plan ? c.plan.filter(m => !m.x).reduce((a, m) => a + m.n, 0) : 0);
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
    `${prof(c)}\nCurso: ${c.title}. Lecciones ya vistas: ${seen}.\n${PHIL}\nEscribe estas lecciones, en orden, conectando cada una con lo anterior:\n${idx.map(j => `${j + 1}. ${c.lessons[j].project ? '[PROYECTO] ' : ''}[Módulo: ${c.lessons[j].module}] ${c.lessons[j].title}: ${c.lessons[j].summary}`).join('\n')}\n\nFormato: {"lessons":[{"theory":"...","exercises":[5 o 6 ejercicios; solo 3 si es [PROYECTO]]}]}\n\n"theory" es markdown de 500 a 800 palabras con EXACTAMENTE esta estructura:\n## ¿Por qué importa? (el problema real que resuelve este tema y qué pasaría sin él)\n## La idea, con una analogía (una analogía cotidiana clara, desarrollada en varias frases)\n## Paso a paso (el concepto desglosado en pasos numerados; define cada término nuevo la primera vez que aparece y explica el porqué de cada paso)\n## Ejemplo comentado (si aplica, un ejemplo de código en bloque con triple acento grave y el lenguaje; ANTES de mostrarlo di qué vamos a lograr, y DESPUÉS explica línea por línea qué hace y por qué)\n## Errores típicos (2 o 3 confusiones frecuentes y cómo evitarlas)\n## En resumen (3 ideas clave)\nAdapta la profundidad y el vocabulario al nivel del alumno. Enseña siempre el concepto general antes del ejemplo concreto.\nSi la lección está marcada [PROYECTO], su "theory" (400 a 600 palabras) NO usa esa estructura sino: ## El reto (qué vas a crear y por qué es útil), ## Lo que necesitas (conceptos del módulo que vas a usar), ## Guía paso a paso (pistas y orden de trabajo, SIN dar la solución completa), ## Cómo saber que lo lograste (criterios claros), ## Para ir más lejos (2 ideas extra). Es una tarea práctica real que el alumno hace por su cuenta, adaptada a la materia (código, texto, receta, dibujo, problema…). Sus ejercicios son 3 preguntas de planificación y autoevaluación del proyecto. En el JSON escapa los saltos de línea como \\n y las comillas dobles internas.\n\nREGLA DE CÓDIGO: TODO código (en "theory", enunciados, opciones y "why") va en bloques con triple acento grave y lenguaje (\`\`\`python), con los saltos de línea escritos como \\n en el JSON; el código corto dentro de una frase va entre \`acentos graves\`. Nunca código como texto plano.\n\nLos ejercicios deben comprobar COMPRENSIÓN (el porqué, predecir resultados, detectar errores, elegir la mejor solución), no memorizar sintaxis. En "why" explica el razonamiento como lo haría un profesor, no solo la respuesta. Mezcla tipos:\n{"type":"choice","q":"","options":["","","",""],"answer":0,"why":""} | {"type":"tf","q":"afirmación","answer":true,"why":""} | {"type":"fill","q":"Frase con ___","answer":"palabra","why":""}`)
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
    const r = await ai('Eres un profesor experto.', `${prof(c)}\nCrea un repaso de: ${src.map(l => l.title).join('; ')}.\nTodo código va en bloques \`\`\`lang (saltos como \\n en el JSON); el código corto, entre \`acentos graves\`.\nFormato: ${f}`);
    r.tool = kind; const html = window.Tools && Tools.placeholder(JSON.stringify(r)); if (!html) throw Error('Repaso inválido');
    ov.innerHTML = bar('home') + `<div class="cv-b">${html}</div><div class="cv-f"><button class="btn pri" data-a="home">Volver al curso</button></div>`;
    Tools.mount(ov);
  } catch (e) { fail(e.message); }
}

// ---------- Vistas ----------
const bar = (a, pct = 0, q = 0) => `<div class="cv-h"><button class="ib" data-a="${a}" aria-label="Salir">✕</button><div class="cv-p"><i style="width:${pct}%"></i></div>${q ? '<button class="dqb" data-a="dq" aria-label="Preguntar una duda">💬 <span>Dudas</span></button>' : ''}<span class="cv-st"${a === 'dash' ? ' data-a="dash" title="Ver racha y rendimiento"' : ''}>🔥 ${st.streak} · ⭐ ${st.xp}</span></div>`;
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
  {k: 'size', q: '¿Qué tan extensa quieres la ruta?', o: ['Corta (~8 lecciones)', 'Media (~16 lecciones)', 'Extensa (~30 lecciones)', 'Maestría (~50 lecciones)', '✏️ Modo personalizado (hasta 100)']}
];
let ob = {i: 0, a: {}};
function onboard() {
  show(); dqHide(); playTok++; const s = QS[ob.i];
  ov.innerHTML = bar('dash', ob.i / QS.length * 100) + `<div class="cv-b cv-q"><h2>${s.q}</h2>` +
    (s.o ? `<div class="opts">${s.o.map((o, k) => `<button class="opt" data-a="${o.startsWith('✏️') ? 'custom' : 'ans'}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`
      : `<input id="obIn" class="fld cv-in" placeholder="${esc(s.ph)}" autocomplete="off"><div class="cv-f2"><button class="btn pri" data-a="ans">Continuar</button></div>`) + `</div>`;
  $('#obIn')?.focus();
}
function custom(v = 20) {
  show(); v = Math.min(100, Math.max(1, Math.round(+v) || 20));
  ov.innerHTML = bar('dash', 90) + `<div class="cv-b cv-q"><div class="tag">Modo personalizado</div><h2>¿Cuántas lecciones quieres?</h2><div class="cn"><button class="ib" data-a="cn" data-d="-1" aria-label="Menos">−</button><input id="cn" class="fld cv-in" type="number" inputmode="numeric" min="1" max="100" value="${v}"><button class="ib" data-a="cn" data-d="1" aria-label="Más">+</button></div><input id="cr" type="range" min="1" max="100" value="${v}" aria-label="Número de lecciones"><p id="cnh" class="mut"></p><div class="cv-f2"><button class="btn" data-a="back">← Volver</button><button class="btn pri" data-a="cok">Continuar</button></div></div>`;
  setCn(v);
}
function setCn(v, from) {
  if (v === '') return; v = Math.min(100, Math.max(1, Math.round(+v) || 1));
  const a = $('#cn'); if (from !== 'cn' || +a.value !== v) a.value = v; $('#cr').value = v;
  $('#cnh').textContent = v <= SHORT ? 'Curso corto: lo creo completo.' : 'Curso largo: lo creo por módulos, a medida que avances.';
}
async function nextMod() {
  const c = cc; retry = nextMod;
  try {
    const S = ['Diseñando el siguiente módulo', 'Escribiendo sus primeras lecciones'];
    if (c.lessons.findIndex(l => !l.done) < 0) { busy('', S, 0); await expand(c); }
    busy('', S, 1); await gen(c, c.lessons.findIndex(l => !l.done), 2);
    save(); sfx('done'); home(); toast('✨ Módulo nuevo listo');
  } catch (e) { fail(e.message); }
}
async function create() {
  const a = ob.a, c = {id: 'c_' + Date.now(), p: {topic: a.topic, level: a.level, time: a.time, goal: a.goal, size: +(a.size.match(/\d+/) || [12])[0]}, lessons: []};
  cc = c; retry = create;
  try {
    const S = ['Diseñando el temario a tu medida', 'Escribiendo tus primeras lecciones'];
    busy('', S, 0); await outline(c);
    busy('', S, 1); await gen(c, 0, 2);
    C[c.id] = c; save(); sfx('done'); home();
  } catch (e) { fail(e.message); }
}
function home() {
  show(); dqHide(); playTok++; sync();
  const c = cc, d = c.lessons.filter(l => l.done).length, T = tl(c), cur = c.lessons.findIndex(l => !l.done), g = [];
  c.lessons.forEach((l, i) => { let m = g[g.length - 1]; if (!m || m.t !== l.module) g.push(m = {t: l.module, ls: []}); m.ls.push([l, i]); });
  const row = ([l, i]) => `<button class="lr ${l.done ? 'done' : i === cur ? 'cur' : 'lock'}" data-a="les" data-i="${i}"><span class="lr-i">${l.done ? '✓' : i === cur ? '▶' : l.project ? '🛠️' : '🔒'}</span><span class="lr-t"><b>${esc(l.title)}</b><small>${esc(l.summary)}</small></span>${l.project ? '<em class="lr-b">Proyecto</em>' : ''}</button>`;
  const mods = g.map((m, k) => `<section class="mc"><div class="mc-h"><b><em>${k + 1}</em>${esc(m.t)}</b><small>${m.ls.filter(x => x[0].done).length}/${m.ls.length}</small></div>${m.ls.map(row).join('')}</section>`).join('');
  const later = c.plan ? c.plan.map((m, j) => [m, j]).filter(x => !x[0].x) : [];
  const soon = later.map(([m, j]) => `<section class="mc lock"><div class="mc-h"><b><em>${j + 1}</em>${esc(m.title)}</b><small>🔒 ~${m.n} lecciones</small></div></section>`).join('');
  const note = later.length ? '<div class="cv-note">🌱 Este curso es largo, así que lo voy creando por partes. Cuando termines el módulo actual te aviso y preparo el siguiente.</div>' : '';
  ov.innerHTML = bar('dash', d / T * 100) +
    `<div class="cv-b"><div class="cv-hero"><h2>${esc(c.title)}</h2><p>${esc(c.desc)}</p><small>${d} / ${T} lecciones · ${Math.round(d / T * 100)}%</small></div>${note}${mods}${soon}</div>` +
    `<div class="cv-f"><button class="btn" data-a="prac">🏋️ Practicar / Repasar</button>${cur >= 0 ? `<button class="btn pri" data-a="les" data-i="${cur}">${d ? 'Continuar' : 'Empezar'}</button>` : later.length ? '<button class="btn pri" data-a="nm">🌱 Crear siguiente módulo</button>' : ''}</div>`;
  ov.querySelector('.lr.cur')?.scrollIntoView({block: 'center'});
}
function practice() {
  ov.innerHTML = bar('home') + `<div class="cv-b cv-q"><h2>¿Cómo quieres practicar?</h2><div class="opts"><button class="opt" data-a="rv" data-k="test">📝 Ensayo de práctica (quiz)</button><button class="opt" data-a="rv" data-k="flashcards">🗂️ Tarjetas de memoria</button></div></div>`;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function intro(l, i) {
  ov.innerHTML = bar('home') + `<div class="cv-b cv-mid cv-intro"><div class="tag">${esc(l.module)}</div><div class="cv-big">${l.project ? '🛠️' : '📖'}</div><h2>${esc(l.title)}</h2><p class="mut">${l.project ? 'Proyecto del módulo' : 'Lección ' + (i + 1) + ' de ' + tl(cc)}</p><div class="intro-bar"><i></i></div><p class="mut">Preparando tu lección…</p></div>`;
}
async function play(i) {
  const c = cc, l = c.lessons[i];
  if (i > c.lessons.findIndex(x => !x.done) && !l.done) return toast('Completa las lecciones anteriores');
  retry = () => play(i); const my = ++playTok, t0 = Date.now(); intro(l, i);
  if (!l.content) {
    const slow = setTimeout(() => { if (my === playTok) busy('Redactando la explicación y los ejercicios…'); }, 4000);
    try { await gen(c, i, 2); } catch (e) { clearTimeout(slow); if (my === playTok) fail(e.message); return; }
    clearTimeout(slow);
  }
  await wait(Math.max(0, 1100 - (Date.now() - t0)));
  if (my !== playTok) return;
  gen(c, i + 1, 2).catch(() => { }); // generación progresiva en segundo plano
  lesson = l; Q = [{th: 1}, ...l.content.ex.map(e => ({...e}))]; n = 0; ok = 0; tot = l.content.ex.length; step(); dqRefresh();
}
function step() {
  if (n >= Q.length) return fin();
  const e = Q[n], pct = n / Q.length * 100;
  if (e.th) { ov.innerHTML = bar('home', pct, 1) + `<div class="cv-b"><div class="tag">Lección · ${esc(lesson.title)}</div><div class="a"><div class="b">${md(lesson.content.theory)}</div></div></div><div class="cv-f"><button class="btn pri" data-a="nx" disabled>Desplázate hasta el final ↓</button></div>`; gate(); return; }
  tried = false;
  ov.innerHTML = bar('home', pct, 1) + `<div class="cv-b cv-q"><div class="tag">${e.retry ? 'Inténtalo otra vez' : 'Ejercicio'}</div><div class="qh">${R(e.q)}</div>` +
    (e.type === 'fill' ? `<input id="exIn" class="fld cv-in" placeholder="Escribe tu respuesta…" autocomplete="off" autocapitalize="off">`
      : `<div class="opts">${e.options.map((o, k) => `<button class="opt" data-a="pk" data-k="${k}">${R(o)}</button>`).join('')}</div>`) +
    `</div><div class="cv-f"><button class="btn pri" data-a="chk" disabled>Comprobar</button></div>`;
  $('#exIn')?.focus();
}
function gate() { // "Entendido" se activa al llegar al final de la explicación
  const b = ov.querySelector('.cv-b'), k = ov.querySelector('[data-a=nx]');
  const chk = () => { if (b.scrollHeight - b.scrollTop - b.clientHeight < 24) { k.disabled = false; k.textContent = 'Entendido'; b.removeEventListener('scroll', chk); } };
  b.addEventListener('scroll', chk, {passive: true}); requestAnimationFrame(chk); setTimeout(chk, 350);
}
function check() {
  const e = Q[n]; let good, pick = ov.querySelector('.opt.sel'), inp = $('#exIn');
  if (e.type === 'fill') good = norm(inp.value) === norm(e.answer); else good = +pick.dataset.k === e.answer;
  sfx(good ? 'ok' : 'bad');
  if (good && !e.retry) ok++;
  if (!good && !e.retry) Q.push({...e, retry: 1});
  ov.querySelectorAll('.opt').forEach((o, k) => { o.disabled = true; if (k === e.answer) o.classList.add('good'); else if (o === pick) o.classList.add('bad'); });
  if (inp) { inp.disabled = true; inp.classList.add(good ? 'good' : 'bad'); }
  const ans = good ? '' : `<div class="wy"><b>Respuesta:</b> ${e.type === 'fill' ? esc(e.answer) : R(e.options[e.answer])}</div>`;
  ov.querySelector('.cv-f').outerHTML = `<div class="cv-f fb ${good ? 'ok' : 'no'}"><div class="cv-fb"><b>${good ? '✅ ¡Correcto!' : '❌ Incorrecto'}</b>${ans}${e.why ? `<div class="wy">${R(e.why)}</div>` : ''}</div><button class="btn pri" data-a="nx">Continuar</button></div>`;
}
function fin() {
  const l = lesson, first = !l.done, gain = first ? 20 + ok * 5 : 5; sync();
  const was = st.last === dkey();
  l.done = true; st.xp += gain; st.acc.ok += ok; st.acc.tot += tot; activate(); save(); sfx('done');
  const sk = was ? '' : '<p class="tag">🔥 Racha de ' + st.streak + (st.streak > 1 ? ' días' : ' día') + '</p>';
  const d = cc.lessons.filter(x => x.done).length, nx = cc.lessons.findIndex(x => !x.done);
  const more = nx < 0 && cc.plan && cc.plan.some(m => !m.x), all = nx < 0 && !more, mod = l.project, nm = more ? cc.plan.find(m => !m.x) : null;
  ov.innerHTML = bar('home', 100) + `<div class="cv-b cv-mid"><div class="cv-big">${all ? '🏆' : mod ? '🏁' : '🎉'}</div><h2>${all ? '¡Curso completado!' : mod ? '¡Módulo completado!' : '¡Lección completada!'}</h2><p>+${gain} ⭐ · ${ok}/${tot} a la primera</p>${sk}${mod ? '<p class="cv-note">🛠️ Si aún no hiciste el proyecto del módulo, tómate un rato para construirlo por tu cuenta: es lo que fija de verdad lo aprendido.</p>' : ''}${more ? `<p class="cv-note">🌱 Para no abrumarte, creo el curso por partes. Ahora preparo el siguiente módulo, «${esc(nm.title)}», a medida que avanzas.</p><button class="btn pri" data-a="nm">🌱 Crear el siguiente módulo</button>` : ''}${d % 3 === 0 || all ? `<p class="tag">Buen momento para reforzar lo aprendido</p><button class="btn pri" data-a="rv" data-k="${(d / 3) % 2 ? 'flashcards' : 'test'}">⚡ Repaso de refuerzo</button>` : ''}${all || more ? '' : `<button class="btn ${d % 3 ? 'pri' : ''}" data-a="les" data-i="${nx}">Siguiente lección</button>`}<button class="btn" data-a="home">Ver ruta</button></div>`;
}

// ---------- 3. Chat lateral de dudas ----------
let dq, dqBusy = false;
function dqEnsure() {
  if (dq) return dq;
  dq = document.createElement('aside'); dq.id = 'dq'; dq.hidden = true;
  dq.innerHTML = '<div class="dq-h"><div><b>💬 Dudas de la lección</b><small id="dqT"></small></div><button class="ib" type="button" aria-label="Cerrar">✕</button></div><div id="dqM" class="dq-m"></div><form id="dqF" class="dq-f"><textarea id="dqI" rows="1" placeholder="Pregunta lo que no entendiste…"></textarea><button class="btn pri" type="submit">Enviar</button></form>';
  document.body.append(dq);
  const f = dq.querySelector('form'), i = dq.querySelector('textarea');
  dq.querySelector('.dq-h .ib').onclick = dqHide;
  f.onsubmit = e => { e.preventDefault(); const t = i.value; i.value = ''; i.style.height = 'auto'; dqSend(t); };
  i.oninput = () => { i.style.height = 'auto'; i.style.height = Math.min(120, i.scrollHeight) + 'px'; };
  i.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); f.requestSubmit(); } };
  dq.onclick = e => { const b = e.target.closest('[data-s]'); if (b) dqSend(b.dataset.s); };
  return dq;
}
function dqToggle() {
  dqEnsure(); if (!dq.hidden) return dqHide();
  dq.hidden = false; document.body.classList.add('dq-on'); dqRefresh();
  if (matchMedia('(pointer:fine)').matches) $('#dqI').focus();
}
function dqHide() { if (dq) dq.hidden = true; document.body.classList.remove('dq-on'); }
function dqRefresh() {
  if (!dq || dq.hidden || !lesson) return;
  const ch = lesson.chat || [], m = $('#dqM'), tips = ['Explícamelo de otra forma', 'Dame otro ejemplo', '¿Para qué sirve esto?'];
  $('#dqT').textContent = lesson.title; $('#dqF .btn').disabled = dqBusy;
  m.innerHTML = (ch.length ? '' : `<p class="mut">Pregunta lo que no te quedó claro de esta lección: puedo explicarlo de otra forma, dar otro ejemplo o aclarar un término.</p><div class="dq-s">${tips.map(t => `<button type="button" data-s="${esc(t)}">${esc(t)}</button>`).join('')}</div>`)
    + ch.map(x => `<div class="m ${x.role === 'user' ? 'u' : 'a'}"><div class="b">${x.role === 'user' ? esc(x.content) : md(x.content)}</div></div>`).join('')
    + (dqBusy ? '<div class="m a"><div class="b cur"></div></div>' : '');
  window.Tools && Tools.mount(m); m.scrollTop = m.scrollHeight;
}
async function dqSend(t) {
  t = t.trim(); const l = lesson, c = cc; if (!t || dqBusy || !l) return;
  if (!apiKey) return needKey();
  (l.chat = l.chat || []).push({role: 'user', content: t}); dqBusy = true; dqRefresh();
  try {
    const sys = `Eres un tutor paciente y cercano de un curso. Respondes en español, de tú, claro y breve (máx. ~200 palabras) y con markdown ligero. Si el alumno no entendió algo, explícalo de otra forma, con una analogía o un ejemplo distinto. Enseñas conceptos generales, no recetas sueltas. No resuelvas los ejercicios por el alumno: guíalo con pistas. Si la lección es un proyecto, ayúdalo a avanzar sin darle la solución completa. ${prof(c)}\nCurso: ${c.title}. Módulo: ${l.module}. Lección actual: ${l.title}.\nContenido de la lección (contexto):\n${(l.content?.theory || '').slice(0, 3500)}`;
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: {'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'HTTP-Referer': location.href, 'X-Title': 'Sara AI App'},
      body: JSON.stringify({model: 'openrouter/auto', temperature: .5, messages: [{role: 'system', content: sys}, ...l.chat.slice(-10).map(({role, content}) => ({role, content}))]})
    });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Error(j.error?.message || 'Error ' + r.status);
    const a = (j.choices?.[0]?.message?.content || '').trim(); if (!a) throw Error('Respuesta vacía');
    l.chat.push({role: 'assistant', content: a}); save();
  } catch (e) { l.chat.pop(); if (dq) $('#dqI').value = t; toast(e.message); }
  finally { dqBusy = false; dqRefresh(); }
}

// ---------- Lista lateral y eventos ----------
let cal = new Date(); cal.setDate(1);
function calHTML() {
  const y = cal.getFullYear(), m = cal.getMonth(), f = (new Date(y, m, 1).getDay() + 6) % 7, N = new Date(y, m + 1, 0).getDate(), t = dkey();
  let g = 'LMXJVSD'.split('').map(x => `<span>${x}</span>`).join('') + '<i></i>'.repeat(f);
  for (let d = 1; d <= N; d++) { const k = `${y}-${pad(m + 1)}-${pad(d)}`, c = st.days.includes(k) ? 'on' : st.prot.includes(k) ? 'sh' : ''; g += `<b class="${c}${k === t ? ' td' : ''}">${c === 'sh' ? '🛡️' : d}</b>`; }
  return `<div class="cal-h"><button class="ib" data-a="cal" data-d="-1" aria-label="Mes anterior">‹</button><span>${cal.toLocaleDateString('es', {month: 'long', year: 'numeric'})}</span><button class="ib" data-a="cal" data-d="1" aria-label="Mes siguiente">›</button></div><div class="cal-g">${g}</div>`;
}
function dash() {
  show(); dqHide(); playTok++; sync(); const sc = ov.querySelector('.cv-b')?.scrollTop || 0;
  const cs = Object.values(C).reverse(), dn = cs.flatMap(c => c.lessons).filter(l => l.done).length, ac = st.acc.tot ? Math.round(st.acc.ok / st.acc.tot * 100) : 0;
  const wk = [6, 5, 4, 3, 2, 1, 0].map(i => { const k = dkey(-i); return [k, st.hist[k] || 0]; }), mx = Math.max(1, ...wk.map(x => x[1]));
  const cards = cs.map(c => { const d = c.lessons.filter(l => l.done).length, T = tl(c), p = Math.round(d / T * 100); return `<div class="cc" data-a="open" data-c="${c.id}"><div class="cc-i">🎓</div><div class="cc-t"><b>${esc(c.title)}</b><small>${d}/${T} lecciones · ${p}%</small><div class="cc-p"><i style="width:${p}%"></i></div></div><button class="ib" data-a="del" data-c="${c.id}" aria-label="Eliminar curso">🗑</button></div>`; }).join('') || '<p class="mut">Aún no tienes cursos. Crea el primero.</p>';
  const mt = [['📚', dn, 'Lecciones completadas'], ['🎯', ac + '%', 'Aciertos a la primera'], ['🏅', st.best + (st.best === 1 ? ' día' : ' días'), 'Mejor racha'], ['📅', st.days.length, 'Días activos'], ['🎓', cs.length, 'Cursos'], ['⭐', st.xp, 'Estrellas']];
  const full = st.shields >= MAXS;
  ov.innerHTML = bar('close') + `<div class="cv-b dash">
<div class="ds-stats"><div class="fl"><b>🔥 ${st.streak}</b><small>${st.streak === 1 ? 'día de racha' : 'días de racha'}</small></div><div><b>⭐ ${st.xp}</b><small>estrellas</small></div><div><b>🛡️ ${st.shields}/${MAXS}</b><small>protectores</small></div></div>
<h3 class="ds-h">Mis cursos</h3>${cards}<button class="btn pri" data-a="new">🎓 Crear curso</button>
<h3 class="ds-h">Racha</h3><div class="card" id="calW">${calHTML()}</div>
<div class="card shop"><div class="sp">🛡️</div><div class="ci"><b>Protector de racha</b><small>Si fallas un día, se usa solo y tu racha continúa. Tienes ${st.shields} de ${MAXS}.</small></div><button class="btn pri" data-a="buy" ${full || st.xp < PRICE ? 'disabled' : ''}>${full ? 'Máximo' : PRICE + ' ⭐'}</button></div>
<h3 class="ds-h">Rendimiento</h3><div class="ds-m">${mt.map(x => `<div><span>${x[0]}</span><b>${x[1]}</b><small>${x[2]}</small></div>`).join('')}</div>
<div class="card"><small class="mut">Lecciones de los últimos 7 días</small><div class="wk">${wk.map(([k, v]) => `<div><i style="height:${v / mx * 100}%"></i><small>${new Date(k + 'T00:00').toLocaleDateString('es', {weekday: 'narrow'})}</small></div>`).join('')}</div></div>
<button class="btn" data-a="snd">${st.mute ? '🔇 Sonidos desactivados' : '🔊 Sonidos activados'}</button></div>`;
  ov.querySelector('.cv-b').scrollTop = sc;
}
function init() {
  ov = document.createElement('div'); ov.id = 'cv'; ov.hidden = true; document.body.append(ov);
  $('.tabs [data-m=course]').onclick = () => { document.body.classList.remove('open'); dash(); };
  const A = {
    close: () => { ov.hidden = true; dqHide(); playTok++; }, dash, home: () => home(),
    open: t => { cc = C[t.dataset.c]; home(); }, new: () => { ob = {i: 0, a: {}}; onboard(); },
    del: t => { if (confirm('¿Eliminar este curso?')) { delete C[t.dataset.c]; save(); dash(); } },
    cal: t => { cal.setMonth(cal.getMonth() + +t.dataset.d); $('#calW').innerHTML = calHTML(); },
    snd: () => { st.mute = !st.mute; save(); sfx('tap'); dash(); },
    buy: () => { if (st.shields >= MAXS) return toast('Ya tienes el máximo de protectores'); if (st.xp < PRICE) return toast('Te faltan ' + (PRICE - st.xp) + ' ⭐'); st.xp -= PRICE; st.shields++; save(); sfx('buy'); toast('🛡️ Protector comprado'); dash(); }, retry: () => retry && retry(), prac: practice,
    ans: t => { const s = QS[ob.i], v = t.dataset.v ?? $('#obIn').value.trim(); if (!v) return toast('Escribe una respuesta'); ob.a[s.k] = v; ++ob.i < QS.length ? onboard() : create(); },
    les: t => play(+t.dataset.i), rv: t => review(t.dataset.k), nx: () => { sfx('tap'); n++; step(); },
    pk: t => { ov.querySelectorAll('.opt').forEach(o => o.classList.toggle('sel', o === t)); ov.querySelector('[data-a=chk]').disabled = false; },
    chk: check,
    dq: dqToggle, custom: () => custom(), back: onboard, nm: nextMod,
    cn: t => setCn(+$('#cn').value + +t.dataset.d),
    cok: () => { const v = Math.min(100, Math.max(1, Math.round(+$('#cn').value) || 0)); if (!v) return toast('Elige entre 1 y 100'); ob.a.size = 'Personalizado (' + v + ' lecciones)'; create(); }
  };
  ov.onclick = e => { const t = e.target.closest('[data-a]'); if (t && !t.disabled) A[t.dataset.a]?.(t); };
  ov.oninput = e => { const i = e.target.id; if (i === 'exIn') ov.querySelector('[data-a=chk]').disabled = !e.target.value.trim(); else if (i === 'cn' || i === 'cr') setCn(e.target.value, i); };
  ov.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('.cv-in')) { e.preventDefault(); (ov.querySelector('[data-a=chk]:not(:disabled)') || ov.querySelector('.cv-f2 .btn.pri'))?.click(); } };
  kv.get('courses').then(d => { if (d) { C = d.C || {}; Object.assign(st, d.st); } mig(); sync(); });
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
