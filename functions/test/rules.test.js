/* eslint-disable max-len */
import {test, before, after, beforeEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';

const PROJECT = 'messen-g-er2';
const TS = {'.sv': 'timestamp'};
const root = new URL('../../', import.meta.url);

const [dbHost, dbPort] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
const [stHost, stPort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199').split(':');

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    database: {
      host: dbHost, port: Number(dbPort),
      rules: readFileSync(new URL('database.rules.json', root), 'utf8'),
    },
    storage: {
      host: stHost, port: Number(stPort),
      rules: readFileSync(new URL('storage.rules', root), 'utf8'),
    },
  });
});

after(async () => {
  await env.cleanup();
});

const message = (authorId, extra = {}) => ({
  authorId, authorName: 'Name', createdAt: 1000, duration: 5, mimeType: 'audio/webm',
  location: 'Somewhere', status: 'ready', audioPath: 'recordings/j1/m1.mp3',
  transcript: 'hello', summary: 'hi', peaks: [0.1, 0.5, 1], ...extra,
});

const newMessage = (authorId, extra = {}) => ({
  authorId, authorName: 'Name', createdAt: TS, duration: 5, mimeType: 'audio/webm',
  location: 'Somewhere', status: 'uploading', peaks: [0.1, 0.5, 1], ...extra,
});

beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref().set({
      journals: {
        j1: {
          meta: {name: 'One', color: '#5b7c99', inviteToken: 'tok', createdBy: 'alice', createdAt: 1},
          members: {
            alice: {displayName: 'Alice', joinedAt: 1, lastSeenAt: 1},
            bob: {displayName: 'Bob', joinedAt: 2, lastSeenAt: 1},
          },
          messages: {m1: message('alice'), m2: message('bob', {audioPath: 'recordings/j1/m2.mp3'})},
        },
        j2: {
          meta: {name: 'Two', color: '#6b8f71', inviteToken: 'tok2', createdBy: 'carol', createdAt: 1},
          members: {carol: {displayName: 'Carol', joinedAt: 1, lastSeenAt: 1}},
          messages: {x1: message('carol')},
        },
      },
      userJournals: {alice: {j1: true}, bob: {j1: true}, carol: {j2: true}},
      inviteTokens: {tok: 'j1', tok2: 'j2'},
    });
  });
});

const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).database();

/* ---------- reading ---------- */

test('only members can read a journal and everything in it', async () => {
  for (const path of ['journals/j1', 'journals/j1/meta', 'journals/j1/members',
    'journals/j1/messages', 'journals/j1/messages/m1', 'journals/j1/listens',
    'journals/j1/reactions']) {
    await assertSucceeds(db('bob').ref(path).get());
    await assertFails(db('carol').ref(path).get());
    await assertFails(db().ref(path).get());
  }
});

test('nobody can list all journals or read the old global feed', async () => {
  await assertFails(db('alice').ref('journals').get());
  await assertFails(db('alice').ref('messages').get());
  await assertFails(db('alice').ref().get());
});

test('the message query a member runs is allowed, a non-member is not', async () => {
  const q = (uid) => db(uid).ref('journals/j1/messages').orderByChild('createdAt').limitToLast(10);
  await assertSucceeds(q('alice').get());
  await assertFails(q('carol').get());
});

test('userJournals are private to their owner', async () => {
  await assertSucceeds(db('bob').ref('userJournals/bob').get());
  await assertFails(db('bob').ref('userJournals/alice').get());
  await assertFails(db('bob').ref('userJournals/bob/j1').set(null));
  await assertFails(db('bob').ref('userJournals/bob/j2').set(true));
});

test('invite tokens are not readable or writable by clients', async () => {
  await assertFails(db('alice').ref('inviteTokens/tok').get());
  await assertFails(db('alice').ref('inviteTokens').get());
  await assertFails(db('alice').ref('inviteTokens/new').set('j1'));
});

/* ---------- messages ---------- */

test('a member can post a message as themselves', async () => {
  await assertSucceeds(db('bob').ref('journals/j1/messages/new').set(newMessage('bob')));
});

test('posting is rejected for non-members, impersonation and server-owned fields', async () => {
  await assertFails(db('carol').ref('journals/j1/messages/new').set(newMessage('carol')));
  await assertFails(db('bob').ref('journals/j1/messages/new').set(newMessage('alice')));
  for (const extra of [{transcript: 'x'}, {summary: 'x'}, {audioPath: 'recordings/j1/x.mp3'},
    {status: 'ready'}, {deletedAt: TS}, {extra: 'nope'}]) {
    await assertFails(db('bob').ref('journals/j1/messages/new').set(newMessage('bob', extra)));
  }
  await assertFails(db('bob').ref('journals/j1/messages/new')
      .set(newMessage('bob', {createdAt: 5})));
  await assertFails(db('bob').ref('journals/j1/messages/new')
      .set(newMessage('bob', {mimeType: 'text/html'})));
});

test('existing messages cannot be overwritten, edited or hard-deleted', async () => {
  await assertFails(db('bob').ref('journals/j1/messages/m1').set(newMessage('bob')));
  await assertFails(db('alice').ref('journals/j1/messages/m1').set(newMessage('alice')));
  await assertFails(db('alice').ref('journals/j1/messages/m1').remove());
  await assertFails(db('bob').ref('journals/j1/messages/m1').remove());
  await assertFails(db('alice').ref('journals/j1/messages/m1/transcript').set('forged'));
  await assertFails(db('alice').ref('journals/j1/messages/m1/audioPath').set('recordings/j2/x.mp3'));
  await assertFails(db('alice').ref('journals/j1/messages/m1/authorId').set('bob'));
});

test('only the author can soft-delete, once', async () => {
  await assertFails(db('bob').ref('journals/j1/messages/m1/deletedAt').set(TS));
  await assertFails(db('carol').ref('journals/j1/messages/m1/deletedAt').set(TS));
  await assertSucceeds(db('alice').ref('journals/j1/messages/m1/deletedAt').set(TS));
  await assertFails(db('alice').ref('journals/j1/messages/m1/deletedAt').set(TS));
  await assertFails(db('alice').ref('journals/j1/messages/m1/deletedAt').remove());
});

test('a former member cannot delete their old messages', async () => {
  await env.withSecurityRulesDisabled((ctx) => ctx.database().ref('journals/j1/members/bob').remove());
  await assertFails(db('bob').ref('journals/j1/messages/m2/deletedAt').set(TS));
});

test('the author can mark their own upload as failed, nothing else', async () => {
  await env.withSecurityRulesDisabled((ctx) => ctx.database()
      .ref('journals/j1/messages/up').set(message('bob', {status: 'uploading'})));
  await assertFails(db('alice').ref('journals/j1/messages/up/status').set('error'));
  await assertFails(db('bob').ref('journals/j1/messages/up/status').set('ready'));
  await assertSucceeds(db('bob').ref('journals/j1/messages/up/status').set('error'));
  await assertFails(db('bob').ref('journals/j1/messages/m2/status').set('error'));
});

/* ---------- listens + reactions ---------- */

test('members record listens for other people’s messages only, as themselves', async () => {
  await assertSucceeds(db('bob').ref('journals/j1/listens/m1/bob').set(TS));
  await assertFails(db('bob').ref('journals/j1/listens/m1/alice').set(TS));
  await assertFails(db('alice').ref('journals/j1/listens/m1/alice').set(TS));
  await assertFails(db('carol').ref('journals/j1/listens/m1/carol').set(TS));
  await assertFails(db('bob').ref('journals/j1/listens/missing/bob').set(TS));
  // already recorded: cannot be rewritten or removed
  await assertFails(db('bob').ref('journals/j1/listens/m1/bob').set(TS));
  await assertFails(db('bob').ref('journals/j1/listens/m1/bob').remove());
});

test('reactions: one per member, from the fixed set, own entry only', async () => {
  await assertSucceeds(db('bob').ref('journals/j1/reactions/m1/bob').set('❤️'));
  await assertSucceeds(db('bob').ref('journals/j1/reactions/m1/bob').set('👍'));
  await assertSucceeds(db('alice').ref('journals/j1/reactions/m1/alice').set('🙏'));
  await assertFails(db('bob').ref('journals/j1/reactions/m1/bob').set('💩'));
  await assertFails(db('bob').ref('journals/j1/reactions/m1/bob').set({a: '❤️', b: '👍'}));
  await assertFails(db('bob').ref('journals/j1/reactions/m1/alice').set('❤️'));
  await assertFails(db('bob').ref('journals/j1/reactions/m1').push('❤️'));
  await assertFails(db('carol').ref('journals/j1/reactions/m1/carol').set('❤️'));
  await assertFails(db('bob').ref('journals/j1/reactions/nope/bob').set('❤️'));
  await assertSucceeds(db('bob').ref('journals/j1/reactions/m1/bob').remove());
});

/* ---------- meta + members ---------- */

test('any member can rename and recolor; nothing else in meta changes', async () => {
  await assertSucceeds(db('bob').ref('journals/j1/meta/name').set('Renamed'));
  await assertSucceeds(db('bob').ref('journals/j1/meta/color').set('#aabbcc'));
  await assertSucceeds(db('bob').ref('journals/j1/meta').update({name: 'Both', color: '#112233'}));
  await assertFails(db('bob').ref('journals/j1/meta/name').set(''));
  await assertFails(db('bob').ref('journals/j1/meta/name').set('x'.repeat(61)));
  await assertFails(db('bob').ref('journals/j1/meta/name').remove());
  await assertFails(db('bob').ref('journals/j1/meta/color').set('red'));
  await assertFails(db('carol').ref('journals/j1/meta/name').set('Hacked'));
  await assertFails(db('bob').ref('journals/j1/meta/createdBy').set('bob'));
  await assertFails(db('bob').ref('journals/j1/meta/inviteToken').set('mine'));
  await assertFails(db('bob').ref('journals/j1/meta').remove());
  await assertFails(db('bob').ref('journals/j1').remove());
});

test('nobody can add or remove members from the client', async () => {
  const joined = {displayName: 'Carol', joinedAt: 5, lastSeenAt: 5};
  await assertFails(db('carol').ref('journals/j1/members/carol').set(joined));
  await assertFails(db('bob').ref('journals/j1/members/carol').set(joined));
  await assertFails(db('bob').ref('journals/j1/members/alice').remove());
  await assertFails(db('bob').ref('journals/j1/members/bob').remove());
  await assertFails(db('bob').ref('journals/j1/members').remove());
  await assertFails(db('bob').ref('journals/j1/members/bob/joinedAt').set(0));
});

test('a member can update only their own lastSeenAt and display name', async () => {
  await assertSucceeds(db('bob').ref('journals/j1/members/bob/lastSeenAt').set(TS));
  await assertSucceeds(db('bob').ref('journals/j1/members/bob/displayName').set('Bobby'));
  await assertFails(db('bob').ref('journals/j1/members/alice/lastSeenAt').set(TS));
  await assertFails(db('bob').ref('journals/j1/members/bob/lastSeenAt').set(99999999999999));
  await assertFails(db('bob').ref('journals/j1/members/bob/displayName').set(''));
  await assertFails(db('carol').ref('journals/j1/members/carol/lastSeenAt').set(TS));
});

/* ---------- storage ---------- */

const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const bytes = new Uint8Array([1, 2, 3, 4]);
const audio = {contentType: 'audio/webm'};

test('storage: clients may only create uploads in their own folder', async () => {
  await assertSucceeds(st('bob').ref('uploads/bob/j1/m3.webm').put(bytes, audio));
  await assertFails(st('bob').ref('uploads/alice/j1/m3.webm').put(bytes, audio));
  await assertFails(st().ref('uploads/bob/j1/m3.webm').put(bytes, audio));
  await assertFails(st('bob').ref('uploads/bob/j1/m3.webm').put(bytes, {contentType: 'text/html'}));
  await assertFails(st('bob').ref('recordings/j1/m3.mp3').put(bytes, {contentType: 'audio/mpeg'}));
  await assertFails(st('bob').ref('elsewhere/m3.webm').put(bytes, audio));
});

test('storage: clients can never read or delete any file', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref('recordings/j1/m1.mp3').put(bytes, {contentType: 'audio/mpeg'});
    await ctx.storage().ref('uploads/bob/j1/m9.webm').put(bytes, audio);
  });
  for (const path of ['recordings/j1/m1.mp3', 'uploads/bob/j1/m9.webm']) {
    await assertFails(st('alice').ref(path).getMetadata());
    await assertFails(st('bob').ref(path).getDownloadURL());
    await assertFails(st('bob').ref(path).delete());
    await assertFails(st().ref(path).getMetadata());
  }
});
