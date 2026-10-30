const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let mode = 'normal', cur, chats = {}, docs = {}, busy = null, curDoc;
const getKey = () => { try { return (localStorage.getItem('openrouter_api_key') || '').trim(); } catch { return ''; } };
let apiKey = getKey();
const IC = {copy:`<svg class="i" viewBox="0 0 24 24"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg>`,save:`<svg class="i" viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>`,pen:`<svg class="i" viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,stop:`<svg class="i" viewBox="0 0 24 24"><path d="M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/></svg>`,up:`<svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`};
IC.redo = '<svg class="i" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>';
const DEF = {profesor_educativo: {id: 'profesor_educativo', name: '👨‍🏫 Profesor Educativo', prompt: 'Eres un profesor experto y paciente. Tu misión es educar con rigor pedagógico. Explica conceptualmente antes de hacer cosas. Si el usuario te pide un documento, estructúralo de forma didáctica y completa con secciones clarificadoras. Enseñas de todo ya que eres un profesor general.'}};
let asts = JSON.parse(localStorage.getItem('openrouter_assistants') || 'null') || DEF;

// ---------- Almacenamiento en el navegador (IndexedDB; misma BD de siempre, conserva tus chats) ----------
const idb = new Promise((res, rej) => { const r = indexedDB.open('SaraAIDB', 1); r.onupgradeneeded = () => r.result.createObjectStore('handles'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kv = {
  get: async k => { try { const db = await idb; return await new Promise(r => { const q = db.transaction('handles').objectStore('handles').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(); }); } catch { } },
  del: async k => { try { const db = await idb; await new Promise(r => { const t = db.transaction('handles', 'readwrite'); t.objectStore('handles').delete(k); t.oncomplete = t.onerror = t.onabort = () => r(); }); } catch { } },
  set: async (k, v) => { try { const db = await idb; await new Promise(r => { const t = db.transaction('handles', 'readwrite'); t.objectStore('handles').put(v, k); t.oncomplete = t.onerror = t.onabort = () => r(); }); } catch { } }
};
const cache = () => Promise.all([kv.set('chats', chats), kv.set('docs', docs)]);

function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 2600); }
const md = t => { try { return DOMPurify.sanitize(marked.parse(t)); } catch { return '<p style="white-space:pre-wrap">' + esc(t) + '</p>'; } };
if (window.marked) marked.use({renderer: {code(a, b) {
  const code = typeof a === 'object' ? a.text : a, lang = ((typeof a === 'object' ? a.lang : b) || 'texto').split(/\s/)[0];
  const tl = window.Tools && Tools.placeholder(code); if (tl) return tl;
  let h; try { h = hljs.getLanguage(lang) ? hljs.highlight(code, {language: lang, ignoreIllegals: true}).value : esc(code); } catch { h = esc(code); }
  return `<div class="cb"><div class="cbh"><span>${esc(lang)}</span><button class="copy">Copiar</button></div><pre><code>${h}</code></pre></div>`;
}}});

// ---------- Guardado ----------
function persist(c) { c.updatedAt = new Date().toISOString(); return cache(); }

// ---------- API Key (se pide la primera vez y queda guardada en el navegador) ----------
const maskKey = k => k.length > 16 ? k.slice(0, 10) + '…' + k.slice(-4) : '••••';
function keyUI() {
  $('#key').value = apiKey;
  $('#keyState').textContent = apiKey ? 'Guardada en este navegador: ' + maskKey(apiKey) : 'Aún no hay una clave guardada';
}
function needKey(msg) {
  const e = $('#key0Err'); e.hidden = !msg; e.textContent = msg || '';
  $('#key0').value = ''; if (!$('#dKey').open) $('#dKey').showModal(); $('#key0').focus();
}
async function checkKey(k) {
  if (!/^sk-/.test(k)) return 'La clave debe empezar por "sk-".';
  try { const r = await fetch('https://openrouter.ai/api/v1/auth/key', {headers: {Authorization: 'Bearer ' + k}}); if (r.status === 401) return 'OpenRouter no reconoce esta clave. Revisa que esté completa.'; } catch { }
  return '';
}
async function saveKey(k, from) {
  k = k.trim(); const err = await checkKey(k);
  if (err) { if (from === 'dlg') { $('#key0Err').textContent = err; $('#key0Err').hidden = false; } else toast(err); return; }
  apiKey = k; try { localStorage.setItem('openrouter_api_key', k); } catch { } kv.set('apikey', k);
  keyUI(); if ($('#dKey').open) $('#dKey').close(); toast('Clave guardada en este navegador');
}
function clearKey() { try { localStorage.removeItem('openrouter_api_key'); } catch { } kv.del('apikey'); apiKey = ''; keyUI(); }
function resetKey() { if (confirm('¿Borrar la API Key de este navegador?')) { clearKey(); needKey(); } }

const hit = c => { const q = ($('#q')?.value || '').trim().toLowerCase(); return !q || c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q)); };
const vis = () => Object.values(chats).sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
function list() {
  $('#list').innerHTML = vis().filter(hit).map(c => `<div class="it${c.id === cur ? ' on' : ''}" data-id="${esc(c.id)}"><span class="t">${esc(c.title)}</span><button class="rn" title="Renombrar"><svg class="i" viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button><button class="dl" title="Eliminar"><svg class="i" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button></div>`).join('') || `<p class="mut">${mode === 'course' ? 'Aún no hay cursos' : 'Aún no hay chats'}</p>`;
}
function docsUI() {
  $('#docs').innerHTML = Object.values(docs).map(d => `<div class="it" data-d="${esc(d.fileName)}"><span class="t"><svg class="i" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8ZM14 3v5h5"/></svg> ${esc(d.title)}</span></div>`).join('') || '<p class="mut">Sin documentos</p>';
}
function astUI() {
  const s = $('#ast'), v = s.value;
  $('#asts').innerHTML = Object.values(asts).map(a => `<div class="it" title="${esc(a.prompt)}"><span class="t">${esc(a.name)}</span>${a.id === 'profesor_educativo' ? '' : `<button data-a="${esc(a.id)}"><svg class="i" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>`}</div>`).join('');
  s.innerHTML = '<option value="">Sin asistente</option>' + Object.values(asts).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  s.value = cur ? (chats[cur]?.assistantId || '') : (v || 'profesor_educativo');
}
function tabs() { document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.m === mode)); }
function render() {
  list(); docsUI();
  if (cur === undefined || (cur && !chats[cur])) { const l = vis()[0]; l ? open(l.id) : blank(); }
}
function blank() {
  cur = null; $('#title').textContent = 'Nueva conversación'; $('#empty').hidden = false; $('#msgs').hidden = true;
  astUI(); list();
}
function open(id) {
  cur = id; const c = chats[id], m = $('#msgs');
  $('#title').textContent = c.title; $('#empty').hidden = true; m.hidden = false; m.innerHTML = '';
  const lu = c.messages.map(x => x.role).lastIndexOf('user'), la = c.messages.length - 1;
  c.messages.forEach((x, i) => addMsg(x.role, x.content, (x.role === 'user' ? i === lu : i === la) ? i : -1));
  astUI(); list();
  if (innerWidth <= 860) document.body.classList.remove('open');
  m.scrollTop = m.scrollHeight;
}
function bar(role, text, ei) {
  const d = document.createElement('div'); d.className = 'acts';
  const add = (ic, label, fn) => { const x = document.createElement('button'); x.innerHTML = `${ic} ${label}`; x.onclick = fn; d.append(x); };
  add(IC.copy, 'Copiar', () => navigator.clipboard.writeText(text).then(() => toast('Copiado')));
  if (role !== 'user') add(IC.save, 'Guardar', () => saveDoc(text));
  if (ei >= 0) role === 'user' ? add(IC.pen, 'Editar', () => edit(ei)) : add(IC.redo, 'Regenerar', () => regen(ei));
  return d;
}
function addMsg(role, text, ei = -1) {
  const w = document.createElement('div'), b = document.createElement('div'), u = role === 'user';
  w.className = 'm ' + (u ? 'u' : 'a'); b.className = 'b';
  if (u) b.textContent = text; else { b.innerHTML = md(text); window.Tools && Tools.mount(b); }
  w.append(b); if (u ? ei >= 0 : text) w.append(bar(role, text, ei));
  $('#msgs').append(w); return w;
}
function edit(i) {
  const c = chats[cur]; $('#inp').value = c.messages[i].content; c.messages.length = i;
  persist(c); open(cur); grow(); $('#inp').focus();
}
function rename(id) {
  const c = chats[id], t = prompt('Nuevo nombre:', c.title)?.trim();
  if (t) { c.title = t; persist(c); list(); if (id === cur) $('#title').textContent = t; }
}
async function del(id) {
  const c = chats[id]; if (!c || !confirm(`¿Eliminar "${c.title}"?`)) return;
  delete chats[id]; cache();
  if (cur === id) cur = undefined; render();
}
async function saveDoc(text) {
  const t = (text.match(/^#+\s+(.+)$/m)?.[1] || text).replace(/[*_`#]/g, '').trim().slice(0, 40) || 'Documento';
  const fileName = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '_') + '_' + Date.now().toString(36).slice(-4) + '.md';
  docs[fileName] = {fileName, title: t, content: text}; docsUI(); cache();
  toast('Documento guardado en este navegador');
}

function dl(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type: 'text/markdown'})); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportChat() {
  const c = chats[cur]; if (!c) return toast('Abre un chat para exportarlo');
  dl((c.title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'chat') + '.md', '# ' + c.title + '\n\n' + c.messages.map(m => (m.role === 'user' ? '## Tú\n\n' : '## Sara AI\n\n') + m.content).join('\n\n---\n\n'));
}
function regen(i) {
  const c = chats[cur], t = c?.messages[i - 1]?.content; if (!t || busy) return;
  c.messages.length = i - 1; persist(c); open(cur); send(t);
}
const near = () => { const m = $('#msgs'); return m.scrollHeight - m.scrollTop - m.clientHeight < 140; };
function grow() { const i = $('#inp'); i.style.height = 'auto'; i.style.height = i.scrollHeight + 'px'; }
function setBusy(on) { $('#go').classList.toggle('stop', on); $('#go').innerHTML = on ? IC.stop : IC.up; }

async function send(text) {
  text = text.trim(); if (!text || busy) return;
  if (!apiKey) return needKey();
  let c = chats[cur];
  if (!c) {
    const t = Date.now();
    c = chats['chat_' + t] = {id: 'chat_' + t, fileName: `chat_${t}.json`, title: text.slice(0, 40), type: mode === 'course' ? 'course' : 'normal', assistantId: $('#ast').value, createdAt: new Date().toISOString(), messages: []};
  }
  c.messages.push({role: 'user', content: text}); persist(c); open(c.id);
  const w = addMsg('assistant', ''), b = w.firstChild; b.classList.add('cur'); $('#msgs').scrollTop = 1e9;
  const ctl = busy = new AbortController(); setBusy(true);
  let acc = '', n = 0, timer = 0; const t0 = Date.now();
  const paint = () => { timer = 0; const s = near(); b.innerHTML = md(acc); $('#speed').textContent = Math.round(n / ((Date.now() - t0) / 1000)) + ' t/s'; if (s) $('#msgs').scrollTop = 1e9; };
  try {
    const sys = [asts[c.assistantId]?.prompt, window.Tools?.prompt()].filter(Boolean).join('\n\n');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: {'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': location.href, 'X-Title': 'Sara AI App'},
      body: JSON.stringify({model: $('#model').value, stream: true, temperature: .7, messages: [...(sys ? [{role: 'system', content: sys}] : []), ...c.messages.map(({role, content}) => ({role, content}))]})
    });
    if (!res.ok) { const er = new Error((await res.json().catch(() => ({}))).error?.message || 'Error ' + res.status); er.status = res.status; throw er; }
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const {done, value} = await rd.read(); if (done) break;
      buf += dec.decode(value, {stream: true});
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) {
        if (!l.startsWith('data:')) continue;
        const d = l.slice(5).trim(); if (!d || d === '[DONE]') continue;
        try { const t = JSON.parse(d).choices?.[0]?.delta?.content; if (t) { acc += t; n++; timer ||= setTimeout(paint, 120); } } catch { }
      }
    }
  } catch (e) {
    if (e.status === 401) { clearKey(); needKey('Tu API Key no es válida o expiró. Ingresa una nueva.'); }
    if (e.name !== 'AbortError') { toast(e.message); if (!acc) b.innerHTML = `<p style="color:#f87171">${esc(e.message)}</p>`; }
  } finally { clearTimeout(timer); busy = null; setBusy(false); b.classList.remove('cur'); }
  if (!acc) return;
  b.innerHTML = md(acc); window.Tools && Tools.mount(b); w.append(bar('assistant', acc, c.messages.length));
  c.messages.push({role: 'assistant', content: acc}); persist(c); list();
  if (['crea un documento', 'genera un documento', 'haz un documento', 'crear documento', 'documento sobre'].some(k => text.toLowerCase().includes(k))) saveDoc(acc);
}

$('#f').onsubmit = e => { e.preventDefault(); if (busy) return busy.abort(); const t = $('#inp').value; $('#inp').value = ''; grow(); send(t); };
$('#inp').oninput = grow;
$('#inp').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); $('#f').requestSubmit(); } };
$('#empty').onclick = e => { const q = e.target.closest('[data-q]'); if (q) send(q.dataset.q); };
$('#list').onclick = e => {
  const it = e.target.closest('[data-id]'); if (!it) return;
  if (e.target.closest('.rn')) rename(it.dataset.id); else if (e.target.closest('.dl')) del(it.dataset.id); else open(it.dataset.id);
};
$('#docs').onclick = e => { const i = e.target.closest('[data-d]'); if (!i) return; const d = curDoc = docs[i.dataset.d]; $('#dTitle').textContent = d.title; $('#dBody').firstChild.innerHTML = md(d.content); $('#dDoc').showModal(); };
$('#asts').onclick = e => { const b = e.target.closest('[data-a]'); if (b && confirm('¿Eliminar este asistente?')) { delete asts[b.dataset.a]; localStorage.setItem('openrouter_assistants', JSON.stringify(asts)); astUI(); } };
$('#astNew').onclick = () => $('#dAst').showModal();
$('#aSave').onclick = () => {
  const name = $('#aName').value.trim(), prompt = $('#aPrompt').value.trim();
  if (!name || !prompt) return toast('Completa ambos campos');
  const id = 'ast_' + Date.now(); asts[id] = {id, name, prompt};
  localStorage.setItem('openrouter_assistants', JSON.stringify(asts));
  $('#aName').value = $('#aPrompt').value = ''; $('#dAst').close(); astUI();
};
document.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  const b = e.target.closest('.copy');
  if (b) navigator.clipboard.writeText(b.closest('.cb').querySelector('code').innerText).then(() => { b.textContent = '¡Copiado!'; setTimeout(() => b.textContent = 'Copiar', 1500); });
});
$('#newBtn').onclick = () => { blank(); document.body.classList.remove('open'); $('#inp').focus(); };
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { mode = b.dataset.m; tabs(); cur = undefined; render(); });
$('#ast').onchange = e => { const c = chats[cur]; if (c) { c.assistantId = e.target.value; persist(c); } };
$('#model').onchange = e => localStorage.setItem('model', e.target.value);
$('#title').onclick = () => cur && rename(cur);
$('#menu').onclick = () => document.body.classList.toggle(innerWidth <= 860 ? 'open' : 'closed');
$('#x').onclick = $('#scrim').onclick = () => document.body.classList.remove('open');
$('#keySave').onclick = () => saveKey($('#key').value);
$('#keyReset').onclick = resetKey;
$('#key').onkeydown = e => { if (e.key === 'Enter') saveKey($('#key').value); };
$('#key0Save').onclick = () => saveKey($('#key0').value, 'dlg');
$('#key0').onkeydown = e => { if (e.key === 'Enter') saveKey($('#key0').value, 'dlg'); };
$('#dKey').addEventListener('cancel', e => e.preventDefault());
const eye = (b, i) => b.onclick = () => { i.type = i.type === 'password' ? 'text' : 'password'; };
eye($('#keyEye'), $('#key')); eye($('#key0Eye'), $('#key0'));
$('#q').oninput = list;
$('#exp').onclick = exportChat;
$('#dDl').onclick = () => curDoc && dl(curDoc.fileName, curDoc.content);
$('#dDel').onclick = () => { if (curDoc && confirm('¿Eliminar este documento?')) { delete docs[curDoc.fileName]; cache(); docsUI(); $('#dDoc').close(); } };
$('#msgs').onscroll = () => $('#down').hidden = near();
$('#down').onclick = () => $('#msgs').scrollTo({top: 1e9, behavior: 'smooth'});

(async () => {
  keyUI(); $('#model').value = localStorage.getItem('model') || $('#model').value;
  astUI(); tabs();
  try { navigator.storage?.persist?.(); } catch { }
  chats = await kv.get('chats') || {}; docs = await kv.get('docs') || {};
  kv.del('rootDirHandle'); kv.del('deleted');
  blank(); render();
  if (!apiKey) { const k = await kv.get('apikey'); if (k) { apiKey = k; try { localStorage.setItem('openrouter_api_key', k); } catch { } keyUI(); } }
  if (!apiKey) needKey();
})();
