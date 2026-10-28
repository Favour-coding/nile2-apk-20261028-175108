/**
 * @license
 * HTML to APK Studio - Login + Sync (Firebase) Shim
 * Pinned official Firebase JS SDK v10.12.2
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  enableIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

(function () {
  const REQUIRE_BIOMETRIC = true;
  const config = window.FIREBASE_CONFIG;

  if (!config || !config.apiKey || !config.projectId) {
    console.error('[AppSync] Missing window.FIREBASE_CONFIG. Sync shim not initialized.');
    return;
  }

  // 1. Initialize Firebase App & Services
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // Enable persistence
  try {
    setPersistence(auth, browserLocalPersistence).catch(() => {});
  } catch (_) {}

  try {
    enableIndexedDbPersistence(db).catch((err) => {
      console.warn('[AppSync] IndexedDB persistence notice:', err.code);
    });
  } catch (_) {}

  // 2. Timestamps tracking for LocalStorage per-key conflict resolution
  const TS_STORAGE_KEY = '__app_sync_timestamps__';
  let localTimestamps = {};
  try {
    const raw = window.localStorage.getItem(TS_STORAGE_KEY);
    if (raw) localTimestamps = JSON.parse(raw);
  } catch (_) {
    localTimestamps = {};
  }

  function saveTimestamps() {
    try {
      window.localStorage.setItem(TS_STORAGE_KEY, JSON.stringify(localTimestamps));
    } catch (_) {}
  }

  // Reference original localStorage methods
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
  const originalClear = window.localStorage.clear.bind(window.localStorage);

  let currentUser = null;
  let isMergingRemote = false;
  let debounceTimer = null;
  let firestoreUnsubscribe = null;

  // 3. UI Overlay: Sign In / Sign Up Modal
  const overlay = document.createElement('div');
  overlay.id = 'app-sync-auth-overlay';
  overlay.setAttribute(
    'style',
    'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0f172a;z-index:9999999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#f8fafc;padding:16px;box-sizing:border-box;'
  );

  overlay.innerHTML = `
    <div style="width:100%;max-width:380px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:#2563eb;color:#fff;margin-bottom:12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <h2 id="sync-auth-title" style="margin:0 0 4px 0;font-size:18px;font-weight:600;color:#f8fafc;">Account & Cloud Sync</h2>
        <p id="sync-auth-subtitle" style="margin:0;font-size:12px;color:#94a3b8;">Sign in to sync your app data across devices</p>
      </div>

      <div style="display:flex;background:#0f172a;border-radius:8px;padding:3px;margin-bottom:16px;">
        <button id="sync-tab-signin" type="button" style="flex:1;padding:8px;font-size:12px;font-weight:600;border:none;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;">Sign In</button>
        <button id="sync-tab-signup" type="button" style="flex:1;padding:8px;font-size:12px;font-weight:600;border:none;border-radius:6px;background:transparent;color:#94a3b8;cursor:pointer;">Create Account</button>
      </div>

      <form id="sync-auth-form" style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="display:block;font-size:11px;font-weight:500;color:#cbd5e1;margin-bottom:4px;">Email Address</label>
          <input id="sync-email" type="email" required autocomplete="email" placeholder="you@example.com" style="width:100%;box-sizing:border-box;padding:10px 12px;font-size:13px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f8fafc;outline:none;" />
        </div>

        <div>
          <label style="display:block;font-size:11px;font-weight:500;color:#cbd5e1;margin-bottom:4px;">Password</label>
          <input id="sync-password" type="password" required autocomplete="current-password" placeholder="••••••••" style="width:100%;box-sizing:border-box;padding:10px 12px;font-size:13px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f8fafc;outline:none;" />
        </div>

        <div id="sync-error" style="display:none;padding:8px 10px;font-size:11px;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;line-height:1.4;"></div>

        <button id="sync-submit-btn" type="submit" style="margin-top:6px;padding:11px;font-size:13px;font-weight:600;border-radius:8px;border:none;background:#2563eb;color:#ffffff;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
          <span>Sign In</span>
        </button>
      </form>

      <div id="sync-biometric-section" style="display:none;text-align:center;padding:12px 0;">
        <div style="font-size:32px;margin-bottom:8px;">🔒</div>
        <h3 style="margin:0 0 6px 0;font-size:15px;color:#f8fafc;">Biometric Verification Required</h3>
        <p style="margin:0 0 16px 0;font-size:12px;color:#94a3b8;">Verify your fingerprint or face to open this app</p>
        <button id="sync-bio-retry-btn" type="button" style="padding:10px 18px;font-size:13px;font-weight:600;border-radius:8px;border:none;background:#4f46e5;color:#fff;cursor:pointer;">
          Unlock with Biometrics
        </button>
      </div>
    </div>
  `;

  // Attach overlay as soon as DOM is ready
  if (document.body) {
    document.body.appendChild(overlay);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(overlay));
  }

  // Floating user sync status pill (shows logged in status & sign out option)
  const syncPill = document.createElement('div');
  syncPill.id = 'app-sync-status-pill';
  syncPill.setAttribute(
    'style',
    'position:fixed;bottom:14px;right:14px;z-index:999990;display:none;align-items:center;gap:6px;background:rgba(15,23,42,0.9);border:1px solid #334155;padding:6px 10px;border-radius:9999px;font-family:-apple-system,sans-serif;font-size:11px;color:#94a3b8;box-shadow:0 4px 12px rgba(0,0,0,0.3);backdrop-filter:blur(8px);cursor:pointer;'
  );
  syncPill.innerHTML = `
    <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;"></span>
    <span id="sync-pill-email" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0;">Sync</span>
    <button id="sync-pill-logout" title="Sign Out" type="button" style="background:none;border:none;color:#ef4444;cursor:pointer;padding:0 2px;font-size:10px;font-weight:600;">Sign out</button>
  `;
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(syncPill));

  let isSignUpMode = false;
  const tabSignIn = overlay.querySelector('#sync-tab-signin');
  const tabSignUp = overlay.querySelector('#sync-tab-signup');
  const authForm = overlay.querySelector('#sync-auth-form');
  const emailInput = overlay.querySelector('#sync-email');
  const passwordInput = overlay.querySelector('#sync-password');
  const errorBox = overlay.querySelector('#sync-error');
  const submitBtn = overlay.querySelector('#sync-submit-btn');
  const bioSection = overlay.querySelector('#sync-biometric-section');
  const bioRetryBtn = overlay.querySelector('#sync-bio-retry-btn');

  function showError(msg) {
    errorBox.style.display = 'block';
    errorBox.textContent = msg;
  }

  function clearError() {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  tabSignIn.addEventListener('click', () => {
    isSignUpMode = false;
    tabSignIn.style.background = '#2563eb';
    tabSignIn.style.color = '#fff';
    tabSignUp.style.background = 'transparent';
    tabSignUp.style.color = '#94a3b8';
    submitBtn.querySelector('span').textContent = 'Sign In';
    clearError();
  });

  tabSignUp.addEventListener('click', () => {
    isSignUpMode = true;
    tabSignUp.style.background = '#2563eb';
    tabSignUp.style.color = '#fff';
    tabSignIn.style.background = 'transparent';
    tabSignIn.style.color = '#94a3b8';
    submitBtn.querySelector('span').textContent = 'Create Account';
    clearError();
  });

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const email = emailInput.value.trim();
    const pass = passwordInput.value;

    if (!email || !pass) return;

    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';

    try {
      if (isSignUpMode) {
        await createUserWithEmailAndPassword(auth, email, pass);
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
    } catch (err) {
      console.error('[AppSync] Auth error:', err);
      let message = err.message || 'Authentication failed.';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        message = 'Invalid email or password.';
      } else if (err.code === 'auth/email-already-in-use') {
        message = 'An account with this email already exists. Please sign in.';
      } else if (err.code === 'auth/weak-password') {
        message = 'Password should be at least 6 characters.';
      }
      showError(message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
    }
  });

  // 4. Biometric Authentication Unlock Flow
  function requestBiometricUnlock(onSuccess) {
    if (!REQUIRE_BIOMETRIC) {
      onSuccess();
      return;
    }

    if (window.AndroidBiometric && typeof window.AndroidBiometric.isAvailable === 'function') {
      const isAvailable = window.AndroidBiometric.isAvailable();
      if (!isAvailable) {
        // Biometrics not enrolled on device, proceed directly
        onSuccess();
        return;
      }

      // Show biometric lock state
      authForm.style.display = 'none';
      overlay.querySelector('#sync-tab-signin').parentElement.style.display = 'none';
      bioSection.style.display = 'block';

      window.onBiometricResult = function (success, err) {
        if (success) {
          bioSection.style.display = 'none';
          onSuccess();
        } else {
          console.warn('[AppSync] Biometric auth rejected:', err);
        }
      };

      const triggerPrompt = () => {
        try {
          window.AndroidBiometric.authenticate('Unlock App', 'Verify your fingerprint to continue');
        } catch (_) {}
      };

      bioRetryBtn.onclick = triggerPrompt;
      triggerPrompt();
    } else {
      // Not running inside native biometric Android wrapper (e.g. browser preview)
      onSuccess();
    }
  }

  // 5. Reveal App UI
  function unlockApp() {
    overlay.style.display = 'none';
    syncPill.style.display = 'flex';
    const pillEmail = syncPill.querySelector('#sync-pill-email');
    if (pillEmail && currentUser) {
      pillEmail.textContent = currentUser.email || 'Synced';
    }
  }

  // 6. Firestore LocalStorage Synchronization
  function scheduleLocalSyncToCloud() {
    if (!currentUser || isMergingRemote) return;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      try {
        const payload = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (!key || key === TS_STORAGE_KEY) continue;
          const val = originalGetItem(key);
          payload[key] = {
            v: val,
            t: localTimestamps[key] || Date.now(),
          };
        }

        const userDocRef = doc(db, 'users', currentUser.uid, 'data', 'localStorage');
        await setDoc(
          userDocRef,
          {
            entries: payload,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('[AppSync] Failed to sync localStorage to cloud:', err);
      }
    }, 1000); // 1-second debounce
  }

  const originalGetItem = window.localStorage.getItem.bind(window.localStorage);

  // Wrap window.localStorage
  window.localStorage.setItem = function (key, value) {
    const strVal = String(value);
    localTimestamps[key] = Date.now();
    saveTimestamps();
    originalSetItem(key, strVal);
    scheduleLocalSyncToCloud();
  };

  window.localStorage.removeItem = function (key) {
    delete localTimestamps[key];
    saveTimestamps();
    originalRemoveItem(key);
    scheduleLocalSyncToCloud();
  };

  window.localStorage.clear = function () {
    localTimestamps = {};
    saveTimestamps();
    originalClear();
    scheduleLocalSyncToCloud();
  };

  // 7. Subscribe to Remote Document Changes
  function startSyncingForUser(user) {
    currentUser = user;
    const userDocRef = doc(db, 'users', user.uid, 'data', 'localStorage');

    firestoreUnsubscribe = onSnapshot(
      userDocRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          // Push initial local state up if doc doesn't exist
          scheduleLocalSyncToCloud();
          return;
        }

        const data = snapshot.data();
        const remoteEntries = data.entries || {};
        let modified = false;
        isMergingRemote = true;

        try {
          for (const [key, item] of Object.entries(remoteEntries)) {
            if (!item || typeof item !== 'object') continue;
            const remoteVal = item.v;
            const remoteTs = item.t || 0;
            const localTs = localTimestamps[key] || 0;
            const currentLocalVal = originalGetItem(key);

            // Newest timestamp wins
            if (remoteTs > localTs || currentLocalVal === null) {
              originalSetItem(key, remoteVal);
              localTimestamps[key] = remoteTs;
              modified = true;
            }
          }
          saveTimestamps();
        } finally {
          isMergingRemote = false;
        }

        // Fire custom event "synced" on window
        window.dispatchEvent(
          new CustomEvent('synced', {
            detail: {
              timestamp: Date.now(),
              modified,
            },
          })
        );
      },
      (err) => {
        console.warn('[AppSync] Remote snapshot listener error:', err);
      }
    );
  }

  function stopSyncing() {
    currentUser = null;
    if (firestoreUnsubscribe) {
      firestoreUnsubscribe();
      firestoreUnsubscribe = null;
    }
  }

  // 8. Auth State Observer
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      requestBiometricUnlock(() => {
        unlockApp();
        startSyncingForUser(user);
      });
    } else {
      stopSyncing();
      overlay.style.display = 'flex';
      authForm.style.display = 'flex';
      overlay.querySelector('#sync-tab-signin').parentElement.style.display = 'flex';
      bioSection.style.display = 'none';
      syncPill.style.display = 'none';
    }
  });

  // Sign out listener on floating pill
  document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('sync-pill-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.confirm('Sign out of your account? Local data will remain on this device.')) {
          fbSignOut(auth).catch(() => {});
        }
      });
    }
  });

  // 9. Expose window.AppSync
  window.AppSync = {
    get user() {
      return currentUser;
    },
    signOut: () => fbSignOut(auth),
    saveDoc: async (col, id, data) => {
      if (!currentUser) throw new Error('User not authenticated');
      return setDoc(doc(db, col, id), data, { merge: true });
    },
    getDoc: async (col, id) => {
      const snap = await getDoc(doc(db, col, id));
      return snap.exists() ? snap.data() : null;
    },
    onDoc: (col, id, cb) => {
      return onSnapshot(doc(db, col, id), (snap) => {
        cb(snap.exists() ? snap.data() : null);
      });
    },
  };
})();
