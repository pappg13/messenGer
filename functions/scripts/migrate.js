/**
 * One-off migration: moves the old flat `messages/` feed into a default Journal.
 *
 *   node scripts/migrate.js --email you@example.com [--name Journal] [--apply]
 *
 * Without --apply it only prints what it would do. It never deletes the old
 * `messages/` node or the old `recordings/<id>.mp3` files; remove those yourself once
 * you have checked the result.
 *
 * Against the emulators set FIREBASE_DATABASE_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST
 * and FIREBASE_AUTH_EMULATOR_HOST (the `firebase emulators:exec` command does this).
 * Against production it needs Application Default Credentials.
 */
import crypto from 'crypto';
import {parseArgs} from 'util';
import {admin, db, bucket} from '../admin.js';

/**
 * Pulls the storage object path out of a legacy Firebase download URL.
 * @param {string} url download URL
 * @return {?string} object path
 */
function pathFromUrl(url) {
  const match = /\/o\/([^?]+)/.exec(url || '');
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * @return {Promise<Array>} every Auth user
 */
async function listAllUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

/**
 * Runs the migration.
 * @param {object} options {email, name, apply, log}
 * @return {Promise<object>} summary
 */
export async function migrate({email, name = 'Journal', apply = false, log = console.log}) {
  const marker = (await db().ref('_migrations/journalsV1').once('value')).val();
  if (marker) throw new Error(`Already migrated into journal ${marker.jid}.`);

  const owner = await admin.auth().getUserByEmail(email);
  const legacy = (await db().ref('messages').once('value')).val() || {};
  const users = await listAllUsers();
  const memberIds = new Set(users.map((u) => u.uid));
  Object.values(legacy).forEach((m) => {
    if (m.uid) memberIds.add(m.uid);
  });
  memberIds.add(owner.uid);

  const names = new Map(users.map((u) => [
    u.uid, (u.displayName || (u.email || '').split('@')[0] || 'Someone').slice(0, 60),
  ]));
  Object.values(legacy).forEach((m) => {
    if (m.uid && !names.has(m.uid)) names.set(m.uid, (m.displayName || 'Someone').slice(0, 60));
  });

  const jid = db().ref('journals').push().key;
  const token = crypto.randomBytes(18).toString('base64url');
  const now = Date.now();
  const messages = {};
  const copies = [];
  let lastMessageAt = 0;
  let lastMessageBy = null;

  for (const [id, m] of Object.entries(legacy)) {
    const createdAt = typeof m.timestamp === 'number' ? m.timestamp : now;
    const source = m.audioPath || pathFromUrl(m.audioUrl);
    const target = source ? `recordings/${jid}/${id}.mp3` : null;
    if (source) copies.push({source, target});
    const status = m.status && m.status !== 'uploaded' ? m.status : 'ready';
    messages[id] = {
      authorId: m.uid || owner.uid,
      authorName: (m.displayName || names.get(m.uid) || 'Someone').slice(0, 60),
      createdAt,
      duration: m.duration || 0,
      mimeType: m.mimeType || 'audio/webm',
      location: m.location || 'Unknown location',
      status: ['uploading', 'converting', 'transcribing'].includes(status) ? 'error' : status,
      ...(Array.isArray(m.peaks) ? {peaks: m.peaks} : {}),
      ...(target ? {audioPath: target} : {}),
      ...(typeof m.transcript === 'string' ? {transcript: m.transcript} : {}),
      ...(typeof m.summary === 'string' ? {summary: m.summary} : {}),
    };
    if (createdAt >= lastMessageAt) {
      lastMessageAt = createdAt;
      lastMessageBy = messages[id].authorId;
    }
  }

  const updates = {
    [`journals/${jid}/meta`]: {
      name, color: '#5b7c99', inviteToken: token, createdBy: owner.uid, createdAt: now,
      ...(lastMessageAt ? {lastMessageAt, lastMessageBy} : {}),
    },
    [`inviteTokens/${token}`]: jid,
    '_migrations/journalsV1': {jid, at: now},
  };
  for (const uid of memberIds) {
    updates[`journals/${jid}/members/${uid}`] = {
      displayName: names.get(uid) || 'Someone', joinedAt: now, lastSeenAt: now,
    };
    updates[`userJournals/${uid}/${jid}`] = true;
  }
  for (const [id, message] of Object.entries(messages)) {
    updates[`journals/${jid}/messages/${id}`] = message;
  }

  log(`${apply ? 'Migrating' : 'Dry run:'} ${Object.keys(messages).length} messages, ` +
    `${memberIds.size} members, ${copies.length} audio files into "${name}" (${jid}).`);
  log(`Owner: ${owner.email} (${owner.uid})`);
  const total = Object.keys(messages).length;
  if (!apply) return {jid, messages: total, members: memberIds.size, applied: false};

  const missing = [];
  for (const {source, target} of copies) {
    try {
      await bucket().file(source).copy(bucket().file(target));
    } catch (err) {
      missing.push(source);
      const id = target.split('/').pop().replace(/\.mp3$/, '');
      delete messages[id].audioPath;
      updates[`journals/${jid}/messages/${id}`] = messages[id];
    }
  }
  await db().ref().update(updates);
  if (missing.length) log(`Audio missing for ${missing.length} messages: ${missing.join(', ')}`);
  log(`Done. Invite token: ${token}`);
  return {jid, messages: total, members: memberIds.size, applied: true, missing};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const {values} = parseArgs({options: {
    email: {type: 'string'}, name: {type: 'string', default: 'Journal'}, apply: {type: 'boolean'},
  }});
  if (!values.email) {
    console.error('Usage: node scripts/migrate.js --email <email> [--name Journal] [--apply]');
    process.exit(1);
  }
  migrate({email: values.email, name: values.name, apply: values.apply})
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(err.message); process.exit(1);
      });
}
