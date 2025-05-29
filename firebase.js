// firebase.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';

const firebaseConfig = {
  // Your Firebase config object
  apiKey: "AIzaSyBTbEOe4-u6E7mVuCL3HYVBhd_otrdCKhM",
  authDomain: "messen-g-er2.firebaseapp.com",
  projectId: "messen-g-er2",
  storageBucket: "messen-g-er2.firebasestorage.app",
  messagingSenderId: "905406830029",
  appId: "1:905406830029:web:7e565466436ffd6fffa084",
  databaseURL: "https://messen-g-er2-default-rtdb.europe-west1.firebasedatabase.app/"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

export { app, auth, db, functions, httpsCallable };