import admin from 'firebase-admin';
import {setGlobalOptions} from 'firebase-functions/v2';

// Imported first by every module, so these apply to all functions.
setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: '2GiB',
  region: 'europe-west1',
});

export const DATABASE_URL =
  'https://messen-g-er2-default-rtdb.europe-west1.firebasedatabase.app/';
export const STORAGE_BUCKET =
  process.env.STORAGE_BUCKET || 'messen-g-er2.firebasestorage.app';

if (admin.apps.length === 0) {
  admin.initializeApp({databaseURL: DATABASE_URL, storageBucket: STORAGE_BUCKET});
}

export const db = () => admin.database();
export const bucket = () => admin.storage().bucket(STORAGE_BUCKET);
export {admin};
