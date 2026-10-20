/* eslint-disable max-len */
import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'messen-g-er2';
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: 'messen-g-er2',
  storageBucket: 'messen-g-er2.firebasestorage.app',
  databaseURL: 'https://messen-g-er2-default-rtdb.europe-west1.firebasedatabase.app/',
});
process.env.FUNCTIONS_EMULATOR = 'true';

let j;
let rec;
let admin;
let db;
let bucket;

before(async () => {
  ({admin, db, bucket} = await import('../admin.js'));
  j = await import('../journals.js');
  rec = await import('../recordings.js');
});

after(async () => {
  await Promise.all(admin.apps.map((app) => app.delete()));
});

const call = (uid, data) => ({auth: uid ? {uid} : undefined, data});
const val = async (path) => (await db().ref(path).once('value')).val();
const rejects = (promise, code) => assert.rejects(promise, (err) => err.code === code);

beforeEach(async () => {
  await db().ref().set(null);
  await bucket().deleteFiles({force: true}).catch(() => {});
});

async function seed() {
  await db().ref().set({
    journals: {
      j1: {
        meta: {name: 'One', color: '#5b7c99', inviteToken: 'tokentokentokentoken1', createdBy: 'alice', createdAt: 1},
        members: {alice: {displayName: 'Alice'}, bob: {displayName: 'Bob'}},
        messages: {
          m1: {authorId: 'alice', status: 'ready', audioPath: 'recordings/j1/m1.mp3', transcript: 'hi', summary: 's'},
        },
      },
    },
    userJournals: {alice: {j1: true}, bob: {j1: true}},
    inviteTokens: {tokentokentokentoken1: 'j1'},
  });
}

test('createJournal sets up journal, creator membership, list entry and invite token', async () => {
  const {jid} = await j.createJournalHandler(call('alice', {name: '  Family ', color: '#6b8f71'}));
  const meta = await val(`journals/${jid}/meta`);
  assert.equal(meta.name, 'Family');
  assert.equal(meta.color, '#6b8f71');
  assert.equal(meta.createdBy, 'alice');
  assert.ok(meta.inviteToken.length >= 16);
  assert.ok(await val(`journals/${jid}/members/alice/joinedAt`));
  assert.equal(await val(`userJournals/alice/${jid}`), true);
  assert.equal(await val(`inviteTokens/${meta.inviteToken}`), jid);
});

test('createJournal validates input and requires sign-in', async () => {
  await rejects(j.createJournalHandler(call(null, {name: 'x', color: '#000000'})), 'unauthenticated');
  await rejects(j.createJournalHandler(call('alice', {name: '', color: '#000000'})), 'invalid-argument');
  await rejects(j.createJournalHandler(call('alice', {name: 'x'.repeat(61), color: '#000000'})), 'invalid-argument');
  await rejects(j.createJournalHandler(call('alice', {name: 'x', color: 'red'})), 'invalid-argument');
});

test('joinJournal adds the member instantly, is idempotent, rejects bad tokens', async () => {
  await seed();
  const first = await j.joinJournalHandler(call('carol', {token: 'tokentokentokentoken1'}));
  assert.equal(first.jid, 'j1');
  assert.ok(await val('journals/j1/members/carol/joinedAt'));
  assert.equal(await val('userJournals/carol/j1'), true);
  const joinedAt = await val('journals/j1/members/carol/joinedAt');
  await j.joinJournalHandler(call('carol', {token: 'tokentokentokentoken1'}));
  assert.equal(await val('journals/j1/members/carol/joinedAt'), joinedAt);

  await rejects(j.joinJournalHandler(call('carol', {token: 'doesnotexistdoesnotexist'})), 'not-found');
  await rejects(j.joinJournalHandler(call('carol', {token: '../x'})), 'not-found');
  await rejects(j.joinJournalHandler(call(null, {token: 'tokentokentokentoken1'})), 'unauthenticated');
});

test('leaveJournal removes membership but keeps messages; the creator cannot leave', async () => {
  await seed();
  await j.leaveJournalHandler(call('bob', {jid: 'j1'}));
  assert.equal(await val('journals/j1/members/bob'), null);
  assert.equal(await val('userJournals/bob/j1'), null);
  assert.equal((await val('journals/j1/messages/m1')).authorId, 'alice');
  await rejects(j.leaveJournalHandler(call('alice', {jid: 'j1'})), 'failed-precondition');
});

test('only the creator can delete a journal, and it removes everything', async () => {
  await seed();
  await bucket().file('recordings/j1/m1.mp3').save(Buffer.from('x'));
  await rejects(j.deleteJournalHandler(call('bob', {jid: 'j1'})), 'permission-denied');
  await rejects(j.deleteJournalHandler(call('carol', {jid: 'j1'})), 'permission-denied');
  assert.ok(await val('journals/j1/meta'));

  await j.deleteJournalHandler(call('alice', {jid: 'j1'}));
  assert.equal(await val('journals/j1'), null);
  assert.equal(await val('inviteTokens/tokentokentokentoken1'), null);
  assert.equal(await val('userJournals/alice/j1'), null);
  assert.equal(await val('userJournals/bob/j1'), null);
  const [exists] = await bucket().file('recordings/j1/m1.mp3').exists();
  assert.equal(exists, false);
});

test('getAudioUrl is members-only and never works for deleted messages', async () => {
  await seed();
  await bucket().file('recordings/j1/m1.mp3').save(Buffer.from('audio'));
  await rejects(j.getAudioUrlHandler(call('carol', {jid: 'j1', mid: 'm1'})), 'permission-denied');
  await rejects(j.getAudioUrlHandler(call(null, {jid: 'j1', mid: 'm1'})), 'unauthenticated');
  const {url} = await j.getAudioUrlHandler(call('bob', {jid: 'j1', mid: 'm1'}));
  assert.match(url, /m1\.mp3/);
  await db().ref('journals/j1/messages/m1/deletedAt').set(Date.now());
  await rejects(j.getAudioUrlHandler(call('bob', {jid: 'j1', mid: 'm1'})), 'not-found');
  await rejects(j.getAudioUrlHandler(call('bob', {jid: '../j1', mid: 'm1'})), 'invalid-argument');
});

test('purgeMessage strips transcript, summary and audio from a deleted message', async () => {
  await seed();
  await bucket().file('recordings/j1/m1.mp3').save(Buffer.from('audio'));
  await rec.purgeMessage('j1', 'm1');
  const m = await val('journals/j1/messages/m1');
  assert.equal(m.transcript, undefined);
  assert.equal(m.summary, undefined);
  assert.equal(m.audioPath, undefined);
  assert.equal(m.authorId, 'alice');
  const [exists] = await bucket().file('recordings/j1/m1.mp3').exists();
  assert.equal(exists, false);
});

test('processRecording discards uploads that do not match a real message of that user', async () => {
  await seed();
  await db().ref('journals/j1/messages/m3').set({authorId: 'bob', status: 'uploading'});
  const upload = async (path) => {
    await bucket().file(path).save(Buffer.from('x'), {contentType: 'audio/webm'});
    await rec.processRecording.run({data: {name: path, bucket: bucket().name, contentType: 'audio/webm'}});
    return (await bucket().file(path).exists())[0];
  };
  // another user pointing at bob's message, a non-member, and a message that does not exist
  assert.equal(await upload('uploads/mallory/j1/m3.webm'), false);
  assert.equal(await upload('uploads/carol/j1/m3.webm'), false);
  assert.equal(await upload('uploads/bob/j1/nope.webm'), false);
  // the target message is untouched
  assert.equal((await val('journals/j1/messages/m3')).status, 'uploading');
  assert.equal(admin.apps.length > 0, true);
});
