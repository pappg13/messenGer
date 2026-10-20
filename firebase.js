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

window.firebaseApp = {
  auth: firebase.auth(),
  database: firebase.database(),
  storage: firebase.storage(),
};
