/* Mi tratamiento · Mi ID: cuenta con un código (sin contraseña) para sincronizar entre dispositivos.
   Usa Firebase (inicio de sesión anónimo + Firestore). Cada ID se guarda en el documento
   "trat<id>" de la colección "progresos", con la forma {l1, l2, timestamp, updatedBy, schemaVersion};
   los datos del tratamiento van dentro de l1. */
const FB = 'https://www.gstatic.com/firebasejs/12.18.0/';
// Configuración web del proyecto de Firebase (Configuración del proyecto → Tus apps → firebaseConfig).
const firebaseConfig = null;

const COLL = 'progresos', PREFIX = 'trat', ID_RE = /^[a-z0-9]{8,28}$/;
const st = {
  get(k) { try { return localStorage.getItem(k) } catch (e) { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch (e) {} },
  del(k) { try { localStorage.removeItem(k) } catch (e) {} }
};
const clientId = st.get('trat-client') || (() => { const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); st.set('trat-client', id); return id })();
const $ = id => document.getElementById(id);
const T = window.TRAT;

let code = st.get('trat-code') || '';
let fb = null, ref = null, unsub = null, timer = 0, status = code ? 'connecting' : 'off', outArmed = false;

const MSG = {
  connecting: 'Conectando…',
  ok: 'Sincronizado en tus dispositivos',
  offline: 'Sin conexión. Se guarda aquí y se envía cuando vuelva internet.',
  error: 'No se pudo sincronizar. Revisa tu conexión e inténtalo de nuevo.',
  denied: 'La nube rechazó este ID. Prueba con otro.'
};

function paint() {
  const ready = !!firebaseConfig, on = !!code;
  $('idOff').hidden = on; $('idOn').hidden = !on;
  $('idDot').hidden = !(on && status === 'ok');
  if (!ready && !on) {
    $('idIn').disabled = true; $('idGo').disabled = true; $('idNew').hidden = true;
    $('idErr').textContent = 'Mi ID estará disponible muy pronto.';
  }
  if (on) {
    $('idCode').textContent = code;
    const s = $('idState'); s.textContent = MSG[status] || '';
    s.className = 'st' + (status === 'ok' ? ' ok' : (status === 'error' || status === 'offline' || status === 'denied') ? ' bad' : '');
    $('idOut').textContent = outArmed ? 'Toca otra vez para cerrar sesión' : 'Cerrar sesión en este dispositivo';
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
const pack = s => ({
  l1: { meds: (s.meds || []).map(m => Object.assign({}, m)), c: Object.assign({}, s.c), t: Object.assign({}, s.t) },
  l2: {}, timestamp: fb.fs.serverTimestamp(), updatedBy: clientId, schemaVersion: 1
});
// join two copies: keep every medicine and every check from both; the cloud wins on times and edits
function merge(local, r) {
  const byId = new Map();
  (local.meds || []).forEach(m => byId.set(m.id, m));
  (r.meds || []).forEach(m => byId.set(m.id, m));
  return { meds: [...byId.values()], c: Object.assign({}, local.c, r.c || {}), t: Object.assign({}, local.t, r.t || {}), tf: local.tf || {} };
}

async function connect(id) {
  if (!firebaseConfig) return;
  code = id; st.set('trat-code', code); setStatus('connecting');
  try {
    await loadFb();
    if (unsub) { unsub(); unsub = null }
    ref = fb.fs.doc(fb.db, COLL, PREFIX + code);
    const snap = await fb.fs.getDoc(ref);
    if (snap.exists()) T.set(merge(T.get(), snap.data().l1 || {}));
    await fb.fs.setDoc(ref, pack(T.get()));
    unsub = fb.fs.onSnapshot(ref, s => {
      if (s.metadata.hasPendingWrites || !s.exists()) return;
      const d = s.data();
      if (d.updatedBy !== clientId) { const r = d.l1 || {}; T.set({ meds: r.meds || [], c: r.c || {}, t: r.t || {}, tf: T.get().tf || {} }) }
      setStatus('ok');
    }, () => setStatus('error'));
    setStatus('ok');
  } catch (e) {
    setStatus(navigator.onLine === false ? 'offline' : (e && e.code === 'permission-denied') ? 'denied' : 'error');
  }
}
function push() {
  if (!code || !ref || !fb) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    fb.fs.setDoc(ref, pack(T.get())).then(() => setStatus('ok')).catch(() => setStatus(navigator.onLine === false ? 'offline' : 'error'));
  }, 500);
}
function signOut() {
  if (unsub) { unsub(); unsub = null }
  ref = null; code = ''; st.del('trat-code');
  T.set({ meds: [], c: {}, t: {}, tf: {} }); // this device forgets the data; it stays safe under the ID
  setStatus('off');
}

T.onChange = push;
T.onView = v => { if (v === 'mi-id') { outArmed = false; paint() } };

$('idForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('idIn').value.trim().toLowerCase();
  if (!ID_RE.test(v)) { $('idErr').textContent = 'Tu ID tiene de 8 a 28 letras o números, sin espacios ni tildes.'; return }
  $('idErr').textContent = ''; connect(v);
});
$('idNew').addEventListener('click', () => {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = '';
  const r = crypto.getRandomValues(new Uint32Array(10));
  for (let i = 0; i < 10; i++) s += a[r[i] % a.length];
  $('idErr').textContent = ''; connect(s);
});
$('idCopy').addEventListener('click', () => {
  const done = () => { $('idCopy').textContent = 'Copiado'; setTimeout(() => { $('idCopy').textContent = 'Copiar' }, 1500) };
  const pick = () => { const r = document.createRange(); r.selectNodeContents($('idCode')); const s = getSelection(); s.removeAllRanges(); s.addRange(r) };
  try { navigator.clipboard.writeText(code).then(done, pick) } catch (e) { pick() }
});
$('idOut').addEventListener('click', () => {
  if (!outArmed) { outArmed = true; paint(); return }
  outArmed = false; signOut();
});
window.addEventListener('online', () => { if (code) connect(code) });

paint();
if (code) connect(code);
