/* Mi tratamiento · Mi ID: cuenta con un código (sin contraseña) para sincronizar entre dispositivos.
   Usa Firebase (inicio de sesión anónimo + Firestore). Cada ID se guarda en el documento
   "trat<id>" de la colección "progresos", con la forma {l1, l2, timestamp, updatedBy, schemaVersion};
   los datos del tratamiento van dentro de l1. Proyecto propio de Firebase: medica17mento. */
const FB = 'https://www.gstatic.com/firebasejs/12.18.0/';
// Configuración web del proyecto de Firebase (Configuración del proyecto → Tus apps → firebaseConfig).
const firebaseConfig = {
  apiKey: 'AIzaSyAf8m6qrqiEuif-tcefACvOphtsVuNwAL0',
  authDomain: 'medica17mento.firebaseapp.com',
  projectId: 'medica17mento',
  storageBucket: 'medica17mento.firebasestorage.app',
  messagingSenderId: '98257290127',
  appId: '1:98257290127:web:31aabd4d5e39672f8dc1fa'
};

const COLL = 'progresos', PREFIX = 'trat';
const ID_RE = /^[a-z0-9]{4,28}$/, NEW_RE = /^[a-z0-9]{8,28}$/;
const st = {
  get(k) { try { return localStorage.getItem(k) } catch (e) { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch (e) {} },
  del(k) { try { localStorage.removeItem(k) } catch (e) {} }
};
const clientId = st.get('trat-client') || (() => { const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); st.set('trat-client', id); return id })();
const $ = id => document.getElementById(id);
const T = window.TRAT;

let code = st.get('trat-code') || '';
let fb = null, ref = null, unsub = null, timer = 0, status = code ? 'connecting' : 'off', pending = null;

const MSG = {
  connecting: 'Conectando…',
  ok: 'Sincronizado · se actualiza solo en tus dispositivos',
  offline: 'Sin conexión. Se guarda aquí y se envía cuando vuelva internet.',
  error: 'No se pudo sincronizar. Revisa tu conexión.',
  denied: 'La nube rechazó este ID.'
};
const clean = v => String(v || '').trim().toLowerCase();
const failState = e => navigator.onLine === false ? 'offline' : (e && e.code === 'permission-denied') ? 'denied' : 'error';
const err = (id, t) => { $(id).textContent = t || '' };
const busy = on => ['idGo', 'idNew', 'renOffGo', 'renGo'].forEach(i => { const b = $(i); if (b) b.disabled = on });

function paint() {
  const on = !!code;
  $('idOff').hidden = on; $('idOn').hidden = !on;
  $('idDot').hidden = !(on && status === 'ok');
  if (on) {
    $('idCode').textContent = code;
    $('idStateTx').textContent = MSG[status] || '';
    $('idState').className = 'st' + (status === 'ok' ? ' ok' : (status === 'error' || status === 'offline' || status === 'denied') ? ' bad' : '');
  }
}
function setStatus(s) { status = s; paint() }

async function loadFb() {
  if (fb) return fb;
  const [app, auth, fs] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  const a = app.initializeApp(firebaseConfig, 'tratamiento');
  await auth.signInAnonymously(auth.getAuth(a));
  fb = { fs, db: fs.getFirestore(a) }; return fb;
}
const docFor = id => fb.fs.doc(fb.db, COLL, PREFIX + id);
const ts = () => fb.fs.serverTimestamp();
const pack = s => ({
  l1: { meds: (s.meds || []).map(m => Object.assign({}, m)), c: Object.assign({}, s.c), t: Object.assign({}, s.t) },
  l2: {}, timestamp: ts(), updatedBy: clientId, schemaVersion: 1
});
const fromCloud = r => ({ meds: r.meds || [], c: r.c || {}, t: r.t || {}, tf: (T.get().tf) || {} });
const hasData = d => !!(d.meds && d.meds.some(m => !m.ex));
const same = (a, b) => JSON.stringify([a.meds || [], a.c || {}, a.t || {}]) === JSON.stringify([b.meds || [], b.c || {}, b.t || {}]);

// read an ID, following the note an old ID leaves after «Cambiar ID»
async function readId(id) {
  for (let i = 0; i < 4; i++) {
    const snap = await fb.fs.getDoc(docFor(id));
    if (!snap.exists()) return { id, data: null };
    const l1 = snap.data().l1 || {};
    if (l1.movedTo && ID_RE.test(l1.movedTo)) { id = l1.movedTo; continue }
    return { id, data: l1 };
  }
  return { id, data: null };
}
function use(id) {
  code = id; st.set('trat-code', code);
  ref = docFor(code);
  if (unsub) { unsub(); unsub = null }
  unsub = fb.fs.onSnapshot(ref, s => {
    if (s.metadata.hasPendingWrites || !s.exists()) return;
    const d = s.data(), l1 = d.l1 || {};
    if (l1.movedTo && ID_RE.test(l1.movedTo)) { use(l1.movedTo); return } // the ID was changed on another device
    if (d.updatedBy !== clientId) T.set(fromCloud(l1));
    setStatus('ok');
  }, () => setStatus('error'));
  setStatus('ok');
}

// Entrar: the ID must exist
async function entrar(raw) {
  const id = clean(raw);
  if (!ID_RE.test(id)) return err('idErr', 'Tu ID tiene de 4 a 28 letras o números, sin espacios ni tildes.');
  busy(true); err('idErr');
  try {
    await loadFb();
    const r = await readId(id);
    if (!r.data) return err('idErr', `No existe el ID «${id}». Revisa que esté bien escrito, o tócalo en Crear.`);
    const local = T.get();
    if (hasData(local) && hasData(r.data) && !same(local, r.data)) { pending = r; openChoice(); return }
    if (hasData(r.data)) T.set(fromCloud(r.data));
    else await fb.fs.setDoc(docFor(r.id), pack(local)); // the ID has no medicines of its own yet: keep this device's
    use(r.id); $('idIn').value = '';
  } catch (e) { err('idErr', 'No se pudo entrar. Revisa tu conexión e inténtalo de nuevo.') }
  finally { busy(false) }
}
// Crear: an ID of your own; it must be free. It starts with what this device has.
async function crear(raw) {
  const id = clean(raw);
  if (!NEW_RE.test(id)) return err('idErr', 'Crea un ID de 8 a 28 letras o números, sin espacios ni tildes.');
  busy(true); err('idErr');
  try {
    await loadFb();
    const snap = await fb.fs.getDoc(docFor(id));
    if (snap.exists()) return err('idErr', `El ID «${id}» ya existe. Si es tuyo, toca Entrar.`);
    await fb.fs.setDoc(docFor(id), pack(T.get()));
    use(id); $('idIn').value = '';
  } catch (e) { err('idErr', 'No se pudo crear el ID. Revisa tu conexión e inténtalo de nuevo.') }
  finally { busy(false) }
}
// Cambiar ID: copy to the new ID; the old one keeps a note so your other devices follow
async function cambiar(rawOld, rawNew, errId) {
  const a = clean(rawOld), b = clean(rawNew);
  if (!ID_RE.test(a)) return err(errId, 'Escribe tu ID actual.'), false;
  if (!NEW_RE.test(b)) return err(errId, 'El ID nuevo debe tener de 8 a 28 letras o números.'), false;
  if (a === b) return err(errId, 'El ID nuevo es igual al actual.'), false;
  busy(true); err(errId);
  try {
    await loadFb();
    const r = await readId(a);
    if (!r.data) return err(errId, `No existe el ID «${a}».`), false;
    const taken = await fb.fs.getDoc(docFor(b));
    if (taken.exists()) return err(errId, `El ID «${b}» ya existe. Elige otro.`), false;
    const data = r.id === code ? pack(T.get()) : Object.assign(pack(fromCloud(r.data)), {});
    await fb.fs.setDoc(docFor(b), data);
    await fb.fs.setDoc(docFor(r.id), { l1: { movedTo: b }, l2: {}, timestamp: ts(), updatedBy: clientId, schemaVersion: 1 });
    if (r.id !== code) T.set(fromCloud(data.l1));
    use(b); return true;
  } catch (e) { err(errId, 'No se pudo cambiar el ID. Revisa tu conexión.'); return false }
  finally { busy(false) }
}
function push() {
  if (!code || !ref || !fb) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    fb.fs.setDoc(ref, pack(T.get())).then(() => setStatus('ok')).catch(e => setStatus(failState(e)));
  }, 500);
}
// Salir: this device stops syncing; what it has stays here
function salir() {
  if (unsub) { unsub(); unsub = null }
  ref = null; code = ''; st.del('trat-code'); setStatus('off');
}

// «¿Qué quieres usar?»
function openChoice() { $('chAsk').hidden = false; $('chConfirm').hidden = true; $('choiceBg').hidden = false; document.body.style.overflow = 'hidden' }
function closeChoice() { $('choiceBg').hidden = true; document.body.style.overflow = ''; pending = null; busy(false) }
$('chCancel').addEventListener('click', closeChoice);
$('chCloud').addEventListener('click', () => { const r = pending; closeChoice(); T.set(fromCloud(r.data)); use(r.id); $('idIn').value = '' });
$('chLocal').addEventListener('click', () => { $('chAsk').hidden = true; $('chConfirm').hidden = false });
$('chBack').addEventListener('click', () => { $('chAsk').hidden = false; $('chConfirm').hidden = true });
$('chYes').addEventListener('click', async () => {
  const r = pending; closeChoice();
  try { await fb.fs.setDoc(docFor(r.id), pack(T.get())); use(r.id); $('idIn').value = '' }
  catch (e) { err('idErr', 'No se pudo guardar en tu ID. Revisa tu conexión.') }
});

T.onChange = push;
T.onView = v => { if (v === 'mi-id') { $('renForm').hidden = true; $('renOffForm').hidden = true; $('idForm').hidden = false; err('idErr'); err('renErr'); paint() } };

$('idForm').addEventListener('submit', e => { e.preventDefault(); entrar($('idIn').value) });
$('idNew').addEventListener('click', () => crear($('idIn').value));
$('idRenOff').addEventListener('click', () => { $('idForm').hidden = true; $('renOffForm').hidden = false; err('idErr'); $('renOld').value = clean($('idIn').value); $('renOld').focus() });
$('renOffCancel').addEventListener('click', () => { $('renOffForm').hidden = true; $('idForm').hidden = false; err('idErr') });
$('renOffForm').addEventListener('submit', async e => { e.preventDefault(); if (await cambiar($('renOld').value, $('renNew').value, 'idErr')) { $('renOffForm').hidden = true; $('idForm').hidden = false } });
$('idRen').addEventListener('click', () => { const f = $('renForm'); f.hidden = !f.hidden; err('renErr'); if (!f.hidden) { $('renIn').value = ''; $('renIn').focus() } });
$('renCancel').addEventListener('click', () => { $('renForm').hidden = true; err('renErr') });
$('renForm').addEventListener('submit', async e => { e.preventDefault(); if (await cambiar(code, $('renIn').value, 'renErr')) $('renForm').hidden = true });
$('idCopy').addEventListener('click', () => {
  const done = () => { $('idCopy').textContent = 'Copiado'; setTimeout(() => { $('idCopy').textContent = 'Copiar' }, 1500) };
  const pick = () => { const r = document.createRange(); r.selectNodeContents($('idCode')); const s = getSelection(); s.removeAllRanges(); s.addRange(r) };
  try { navigator.clipboard.writeText(code).then(done, pick) } catch (e) { pick() }
});
$('idOut').addEventListener('click', salir);
window.addEventListener('online', () => { if (code) boot() });

async function boot() {
  try { await loadFb(); const r = await readId(code); use(r.id) }
  catch (e) { setStatus(failState(e)) }
}
paint();
if (code) boot();
