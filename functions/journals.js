import {onCall, HttpsError} from 'firebase-functions/v2/https';
import crypto from 'crypto';
import {admin, db, bucket} from './admin.js';

const COLOR = /^#[0-9a-fA-F]{6}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CALLABLE = {memory: '256MiB', timeoutSeconds: 60};
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;

/**
 * @param {object} request callable request
 * @return {string} the caller's uid
 */
function requireUid(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return uid;
}

/**
 * @param {*} value candidate id
 * @param {string} label name used in the error
 * @return {string} the validated id
 */
function requireId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) {
    throw new HttpsError('invalid-argument', `Invalid ${label}.`);
  }
  return value;
}

/**
 * @param {string} jid journal id
 * @param {string} uid user id
 * @return {Promise<boolean>} whether the user is a member of the journal
 */
export async function isMember(jid, uid) {
  const snap = await db().ref(`journals/${jid}/members/${uid}`).once('value');
  return snap.exists();
}

/**
 * @param {string} uid user id
 * @return {Promise<string>} a display name for the user
 */
async function displayNameFor(uid) {
  try {
    const user = await admin.auth().getUser(uid);
    const name = user.displayName || (user.email || '').split('@')[0];
    return (name || 'Someone').slice(0, 60);
  } catch (err) {
    return 'Someone';
  }
}

export async function createJournalHandler(request) {
  const uid = requireUid(request);
  const name = String(request.data?.name ?? '').trim();
  const color = request.data?.color;
  if (!name || name.length > 60) {
    throw new HttpsError('invalid-argument', 'Give the Journal a name (max 60 characters).');
  }
  if (typeof color !== 'string' || !COLOR.test(color)) {
    throw new HttpsError('invalid-argument', 'Pick a valid color.');
  }

  const jid = db().ref('journals').push().key;
  const token = crypto.randomBytes(18).toString('base64url');
  const now = Date.now();
  await db().ref().update({
    [`journals/${jid}/meta`]: {
      name, color, inviteToken: token, createdBy: uid, createdAt: now,
    },
    [`journals/${jid}/members/${uid}`]: {
      displayName: await displayNameFor(uid), joinedAt: now, lastSeenAt: now,
    },
    [`userJournals/${uid}/${jid}`]: true,
    [`inviteTokens/${token}`]: jid,
  });
  return {jid};
}

export async function joinJournalHandler(request) {
  const uid = requireUid(request);
  const token = request.data?.token;
  if (typeof token !== 'string' || !TOKEN.test(token)) {
    throw new HttpsError('not-found', 'This invite link is not valid.');
  }
  const jid = (await db().ref(`inviteTokens/${token}`).once('value')).val();
  if (!jid) throw new HttpsError('not-found', 'This invite link is not valid.');

  if (!(await isMember(jid, uid))) {
    const now = Date.now();
    await db().ref().update({
      [`journals/${jid}/members/${uid}`]: {
        displayName: await displayNameFor(uid), joinedAt: now, lastSeenAt: now,
      },
      [`userJournals/${uid}/${jid}`]: true,
    });
  }
  return {jid};
}

export async function leaveJournalHandler(request) {
  const uid = requireUid(request);
  const jid = requireId(request.data?.jid, 'journal');
  const createdBy = (await db().ref(`journals/${jid}/meta/createdBy`).once('value')).val();
  if (createdBy === uid) {
    throw new HttpsError('failed-precondition',
        'The creator can’t leave. Delete the Journal instead.');
  }
  await db().ref().update({
    [`journals/${jid}/members/${uid}`]: null,
    [`userJournals/${uid}/${jid}`]: null,
  });
  return {ok: true};
}

export async function deleteJournalHandler(request) {
  const uid = requireUid(request);
  const jid = requireId(request.data?.jid, 'journal');
  const meta = (await db().ref(`journals/${jid}/meta`).once('value')).val();
  if (!meta) throw new HttpsError('not-found', 'Journal not found.');
  if (meta.createdBy !== uid) {
    throw new HttpsError('permission-denied', 'Only the creator can delete this Journal.');
  }

  const members = (await db().ref(`journals/${jid}/members`).once('value')).val() || {};
  const updates = {
    [`journals/${jid}`]: null,
    [`inviteTokens/${meta.inviteToken}`]: null,
  };
  for (const m of Object.keys(members)) updates[`userJournals/${m}/${jid}`] = null;
  await db().ref().update(updates);
  await bucket().deleteFiles({prefix: `recordings/${jid}/`, force: true}).catch(() => {});
  return {ok: true};
}

export async function getAudioUrlHandler(request) {
  const uid = requireUid(request);
  const jid = requireId(request.data?.jid, 'journal');
  const mid = requireId(request.data?.mid, 'message');
  if (!(await isMember(jid, uid))) {
    throw new HttpsError('permission-denied', 'You are not a member of this Journal.');
  }
  const message = (await db().ref(`journals/${jid}/messages/${mid}`).once('value')).val();
  if (!message || message.deletedAt || !message.audioPath) {
    throw new HttpsError('not-found', 'This message has no audio.');
  }
  const file = bucket().file(message.audioPath);

  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    // The emulator cannot sign URLs; a throwaway download token works there.
    const token = crypto.randomUUID();
    await file.setMetadata({metadata: {firebaseStorageDownloadTokens: token}});
    const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
    const base = host.startsWith('http') ? host : `http://${host}`;
    const url = `${base}/v0/b/${bucket().name}/o/${encodeURIComponent(message.audioPath)}` +
      `?alt=media&token=${token}`;
    return {url};
  }
  const [url] = await file.getSignedUrl({
    version: 'v4', action: 'read', expires: Date.now() + SIGNED_URL_TTL_MS,
  });
  return {url};
}

export const createJournal = onCall(CALLABLE, createJournalHandler);
export const joinJournal = onCall(CALLABLE, joinJournalHandler);
export const leaveJournal = onCall(CALLABLE, leaveJournalHandler);
export const deleteJournal = onCall(CALLABLE, deleteJournalHandler);
export const getAudioUrl = onCall(CALLABLE, getAudioUrlHandler);
