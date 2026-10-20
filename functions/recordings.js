import {onObjectFinalized} from 'firebase-functions/v2/storage';
import {onValueCreated} from 'firebase-functions/v2/database';
import path from 'path';
import os from 'os';
import {promises as fs} from 'fs';
import {db, bucket} from './admin.js';
import {transcribeBuffer, summarizeText} from './openai-index.js';

// Input formats the browsers produce: Chrome/Firefox webm, Safari/iOS mp4.
const SUPPORTED_TYPES = /^(audio\/(webm|mp4|x-m4a|m4a|aac)|video\/(webm|mp4))/;
// uploads/<uid>/<journalId>/<messageId>.<ext>; the path is what we trust, not metadata.
const UPLOAD_PATH = /^uploads\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.[a-z0-9]+$/;

let ffmpeg;

/**
 * Loads fluent-ffmpeg on first use.
 */
async function initializeFfmpeg() {
  if (ffmpeg) return;
  const ffmpegModule = await import('fluent-ffmpeg');
  const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;
  ffmpeg = ffmpegModule.default;
  ffmpeg.setFfmpegPath(ffmpegPath);
}

/**
 * Converts any supported recording to mp3.
 * @param {string} input source file
 * @param {string} output target file
 * @return {Promise<void>}
 */
function convertToMp3(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .output(output)
        .on('end', resolve)
        .on('error', reject)
        .run();
  });
}

/**
 * Removes the audio, transcript and summary of a soft-deleted message so other
 * members can no longer read them (rules cannot hide single fields).
 * @param {string} jid journal id
 * @param {string} mid message id
 */
export async function purgeMessage(jid, mid) {
  const ref = db().ref(`journals/${jid}/messages/${mid}`);
  const message = (await ref.once('value')).val();
  if (!message) return;
  await ref.update({audioPath: null, transcript: null, summary: null});
  await bucket().file(message.audioPath || `recordings/${jid}/${mid}.mp3`)
      .delete({ignoreNotFound: true}).catch(() => {});
}

/**
 * Validates a new upload against the message record, converts it to mp3, then
 * transcribes and summarises it once, writing progress onto the message.
 */
export const processRecording = onObjectFinalized(
    {region: 'europe-west1', timeoutSeconds: 540, memory: '2GiB'},
    async (event) => {
      const object = event.data;
      const filePath = object?.name || '';
      const match = UPLOAD_PATH.exec(filePath);
      if (!match || !SUPPORTED_TYPES.test(object?.contentType || '')) return null;
      const [, uid, jid, mid] = match;

      const upload = bucket().file(filePath);
      const msgRef = db().ref(`journals/${jid}/messages/${mid}`);
      const existing = (await msgRef.once('value')).val();
      const member = (await db().ref(`journals/${jid}/members/${uid}`).once('value')).exists();
      const legit = existing && member && existing.authorId === uid && !existing.deletedAt &&
        ['uploading', 'converting', 'transcribing'].includes(existing.status);
      if (!legit) {
        await upload.delete({ignoreNotFound: true}).catch(() => {});
        return null;
      }

      // Patch only while the message still exists and is not deleted.
      const patch = (fields) => msgRef.transaction(
          (cur) => (cur && !cur.deletedAt ? {...cur, ...fields} : cur));

      await initializeFfmpeg();
      const tempSource = path.join(os.tmpdir(), `${jid}-${path.basename(filePath)}`);
      const tempMp3 = path.join(os.tmpdir(), `${jid}-${mid}.mp3`);
      const mp3Path = `recordings/${jid}/${mid}.mp3`;

      try {
        await patch({status: 'converting'});
        await upload.download({destination: tempSource});
        await convertToMp3(tempSource, tempMp3);
        await bucket().upload(tempMp3, {
          destination: mp3Path,
          metadata: {contentType: 'audio/mpeg'},
        });
        await upload.delete({ignoreNotFound: true});

        await patch({audioPath: mp3Path, status: 'transcribing'});
        const metaRef = db().ref(`journals/${jid}/meta`);
        await metaRef.transaction((cur) => (cur ?
          {...cur, lastMessageAt: Date.now(), lastMessageBy: uid} : cur));

        const transcript = await transcribeBuffer(
            await fs.readFile(tempMp3), `${mid}.mp3`);
        const summary = transcript.trim() ? await summarizeText(transcript) : '';
        await patch({transcript, summary, status: 'ready'});

        // Deleted while we were working: take the freshly written content back out.
        const deletedAt = (await msgRef.child('deletedAt').once('value')).val();
        if (deletedAt) await purgeMessage(jid, mid);
      } catch (error) {
        console.error('processRecording failed for', jid, mid, error);
        await patch({status: 'error'}).catch(() => {});
        throw error;
      } finally {
        await Promise.all([
          fs.unlink(tempSource).catch(() => {}),
          fs.unlink(tempMp3).catch(() => {}),
        ]);
      }
      return null;
    });

export const purgeDeletedMessage = onValueCreated(
    {
      ref: '/journals/{jid}/messages/{mid}/deletedAt',
      instance: 'messen-g-er2-default-rtdb',
      region: 'europe-west1',
    },
    async (event) => {
      await purgeMessage(event.params.jid, event.params.mid);
    });
