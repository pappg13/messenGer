// firebase.js
const firebaseConfig = {
  apiKey: "AIzaSyBTbEOe4-u6E7mVuCL3HYVBhd_otrdCKhM",
  authDomain: "messen-g-er2.firebaseapp.com",
  projectId: "messen-g-er2",
  storageBucket: "messen-g-er2.firebasestorage.app",
  messagingSenderId: "905406830029",
  appId: "1:905406830029:web:7e565466436ffd6fffa084",
  databaseURL: "https://messen-g-er2-default-rtdb.europe-west1.firebasedatabase.app/"
};

// Initialize Firebase if it hasn't been initialized yet
let app;
let auth;
let db;
let functions;
let database;

if (!firebase.apps.length) {
  app = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  functions = firebase.app().functions('europe-west1');
  database = firebase.database();
} else {
  app = firebase.app();
  auth = firebase.auth();
  db = firebase.firestore();
  functions = firebase.app().functions('europe-west1');
  database = firebase.database();
}

// Make services available globally
window.firebaseApp = { 
  app, 
  auth, 
  db, 
  functions, 
  database
};

// Debug logs
console.log('Firebase initialized:', firebase.apps.length > 0);
console.log('Auth:', auth !== undefined);
console.log('Firestore:', db !== undefined);
console.log('Functions:', functions !== undefined);
console.log('Database:', database !== undefined);