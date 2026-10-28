import './style.css';

const $ = id => document.getElementById(id);
const pill = (id, text, cls) => { const e = $(id); e.textContent = text; e.className = 'pill ' + (cls || ''); };
const out = (id, text) => { const e = $(id); e.hidden = false; e.textContent = text; };
const row = (k, v) => '<div class="row"><span>' + k + '</span><span>' + v + '</span></div>';
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// 1. Environment
function env() {
  const ua = navigator.userAgent;
  const isFile = location.protocol === 'file:';
  const inApp = /; wv\)/.test(ua) || !!window.AndroidBiometric;
  $('envRows').innerHTML =
    row('Address', esc(isFile ? 'file:// (no web origin)' : location.origin)) +
    row('Loaded how', isFile ? 'Local file' : (location.hostname === 'appassets.androidplatform.net' ? 'Asset loader (best)' : 'Web address')) +
    row('Inside Android app', inApp ? 'Yes' : 'No (normal browser)') +
    row('Screen', screen.width + ' x ' + screen.height) +
    row('Online', navigator.onLine ? 'Yes' : 'No') +
    row('Time', esc(new Date().toLocaleString()));
  pill('envPill', inApp ? 'in app' : 'browser', inApp ? 'ok' : 'warn');
}
window.addEventListener('online', env);
window.addEventListener('offline', env);

// 2. localStorage
function loadLS() {
  try {
    $('count').textContent = localStorage.getItem('lab_count') || '0';
    $('notes').value = localStorage.getItem('lab_notes') || '';
    pill('lsPill', 'working', 'ok');
  } catch (e) { pill('lsPill', 'blocked', 'bad'); }
}
$('inc').onclick = () => {
  try { localStorage.setItem('lab_count', String((+localStorage.getItem('lab_count') || 0) + 1)); loadLS(); }
  catch (e) { pill('lsPill', 'blocked', 'bad'); }
};
$('reset').onclick = () => {
  try { localStorage.setItem('lab_count', '0'); loadLS(); } catch (e) { pill('lsPill', 'blocked', 'bad'); }
};
let noteTimer;
$('notes').oninput = () => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    try { localStorage.setItem('lab_notes', $('notes').value); } catch (e) { pill('lsPill', 'blocked', 'bad'); }
  }, 300);
};
// The sync shim fires this event after it merges cloud data into localStorage
window.addEventListener('synced', loadLS);

// 3. IndexedDB
$('idbBtn').onclick = () => {
  if (!window.indexedDB) { pill('idbPill', 'missing', 'bad'); return; }
  const req = indexedDB.open('lab_db', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onerror = () => { pill('idbPill', 'failed', 'bad'); out('idbOut', String(req.error)); };
  req.onsuccess = () => {
    const db = req.result, stamp = Date.now();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(stamp, 'last');
    tx.oncomplete = () => {
      const r = db.transaction('kv').objectStore('kv').get('last');
      r.onsuccess = () => {
        const ok = r.result === stamp;
        pill('idbPill', ok ? 'working' : 'mismatch', ok ? 'ok' : 'bad');
        out('idbOut', 'Wrote ' + stamp + '\nRead back ' + r.result);
      };
    };
    tx.onerror = () => { pill('idbPill', 'failed', 'bad'); out('idbOut', String(tx.error)); };
  };
};

// 4. Internet
$('netBtn').onclick = async () => {
  pill('netPill', 'loading...', 'warn');
  try {
    const r = await fetch('https://api.github.com/zen', { cache: 'no-store' });
    const txt = await r.text();
    pill('netPill', r.ok ? 'working' : 'HTTP ' + r.status, r.ok ? 'ok' : 'bad');
    out('netOut', txt);
  } catch (e) {
    pill('netPill', 'failed', 'bad');
    out('netOut', String(e) + '\n(Check your internet, or whether the app has INTERNET permission.)');
  }
};

// 5. Biometric bridge (AndroidBiometric is added by your converter's biometric feature)
const bio = () => window.AndroidBiometric;
window.onBiometricResult = (ok, msg) => {
  pill('bioPill', ok ? 'success' : 'failed', ok ? 'ok' : 'bad');
  out('bioOut', 'Result: ' + (ok ? 'success' : 'failed') + (msg ? '\n' + msg : ''));
};
$('bioCheck').onclick = () => {
  if (!bio()) {
    pill('bioPill', 'no bridge', 'warn');
    out('bioOut', 'AndroidBiometric was not found. This is normal in a regular browser. Inside the APK it needs the biometric feature.');
    return;
  }
  try {
    const a = bio().isAvailable();
    const yes = String(a) === 'true';
    pill('bioPill', yes ? 'available' : 'not enrolled', yes ? 'ok' : 'warn');
    out('bioOut', 'isAvailable() returned: ' + a);
  } catch (e) { pill('bioPill', 'error', 'bad'); out('bioOut', String(e)); }
};
$('bioAuth').onclick = () => {
  if (!bio()) { $('bioCheck').click(); return; }
  try {
    pill('bioPill', 'waiting...', 'warn');
    bio().authenticate('Converter Test Lab', 'Confirm it is you');
  } catch (e) { pill('bioPill', 'error', 'bad'); out('bioOut', String(e)); }
};

// 6. Login + Sync (window.FIREBASE_CONFIG and window.AppSync come from the sync shim)
function syncInfo() {
  const cfg = window.FIREBASE_CONFIG, s = window.AppSync;
  let h = row('Firebase config', cfg ? 'found (' + esc(cfg.projectId || '?') + ')' : 'not found') +
          row('Sync shim', s ? 'loaded' : 'not loaded');
  if (s) h += row('Signed in as', esc((s.user && (s.user.email || s.user.uid)) || 'nobody yet'));
  $('syncRows').innerHTML = h;
  $('syncBtn').hidden = !(s && typeof s.saveDoc === 'function');
  pill('syncPill', s ? 'active' : 'off', s ? 'ok' : 'warn');
}
$('syncBtn').onclick = async () => {
  try {
    const s = window.AppSync, stamp = new Date().toISOString();
    await s.saveDoc('lab_tests', 'hello', { stamp });
    const d = await s.getDoc('lab_tests', 'hello');
    out('syncOut', 'Saved ' + stamp + '\nRead back ' + JSON.stringify(d));
  } catch (e) { out('syncOut', 'Failed: ' + e); }
};
window.addEventListener('synced', syncInfo);

// 7. Phone features
$('vibBtn').onclick = () => {
  const ok = navigator.vibrate && navigator.vibrate(200);
  pill('devPill', ok ? 'vibrated' : 'not supported', ok ? 'ok' : 'warn');
};
$('shareBtn').onclick = async () => {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Converter Test Lab', text: 'It works!' });
      pill('devPill', 'shared', 'ok');
    } else {
      pill('devPill', 'no share', 'warn');
      out('devOut', 'navigator.share is not available here.');
    }
  } catch (e) { out('devOut', String(e)); }
};

env();
loadLS();
syncInfo();
setTimeout(syncInfo, 1500);
