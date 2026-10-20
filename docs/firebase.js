const firebaseConfig = {
  apiKey: "AIzaSyBTbEOe4-u6E7mVuCL3HYVBhd_otrdCKhM",
  authDomain: "messen-g-er2.firebaseapp.com",
  projectId: "messen-g-er2",
  storageBucket: "messen-g-er2.firebasestorage.app",
  messagingSenderId: "905406830029",
  appId: "1:905406830029:web:7e565466436ffd6fffa084",
  databaseURL: "https://messen-g-er2-default-rtdb.europe-west1.firebasedatabase.app/"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const database = firebase.database();
const storage = firebase.storage();
// The login page doesn't load the Functions SDK.
const functions = firebase.functions ? firebase.app().functions('europe-west1') : null;

// Local testing: open the app on localhost with ?emulator=1 (and ?emulator=0 to switch
// back). The choice is remembered in localStorage.
const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const emulatorParam = new URLSearchParams(window.location.search).get('emulator');
try {
  if (emulatorParam === '1') localStorage.setItem('useEmulator', '1');
  if (emulatorParam === '0') localStorage.removeItem('useEmulator');
} catch (err) { /* storage unavailable */ }
let useEmulator = false;
try { useEmulator = isLocalHost && localStorage.getItem('useEmulator') === '1'; } catch (err) { /* ignore */ }

if (useEmulator) {
  auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
  database.useEmulator('127.0.0.1', 9000);
  storage.useEmulator('127.0.0.1', 9199);
  if (functions) functions.useEmulator('127.0.0.1', 5001);
  console.info('messenGer: using local Firebase emulators');
}

window.firebaseApp = { auth, database, storage, functions, useEmulator };
