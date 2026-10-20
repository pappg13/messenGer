import {onObjectFinalized} from 'firebase-functions/v2/storage';
import {setGlobalOptions} from 'firebase-functions/v2';
import admin from 'firebase-admin';
import path from 'path';
import os from 'os';
import {promises as fs} from 'fs';
import {transcribeBuffer, summarizeText} from './openai-index.js';

setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: '2GiB',
  region: 'europe-west1',
});

if (admin.apps.length === 0) {
  admin.initializeApp({
    databaseURL: 'https://messen-g-er2-default-rtdb.europe-west1.firebasedatabase.app/',
  });
}

// Input formats the browsers produce: Chrome/Firefox webm, Safari/iOS mp4.
const SUPPORTED_TYPES = /^(audio\/(webm|mp4|x-m4a|m4a|aac)|video\/(webm|mp4))/;

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
 * Converts a new recording to mp3, then transcribes and summarises it once,
 * writing progress onto messages/<messageId> for the client to render.
 */
export const processRecording = onObjectFinalized(
    {region: 'europe-west1', timeoutSeconds: 540, memory: '2GiB'},
    async (event) => {
      const object = event.data;
      const filePath = object?.name || '';
      const contentType = object?.contentType || '';
      const messageId = object?.metadata?.messageId;

      if (!filePath.startsWith('recordings/') || filePath.endsWith('.mp3') ||
          !SUPPORTED_TYPES.test(contentType) || !messageId) {
        return null;
      }

      const msgRef = admin.database().ref(`messages/${messageId}`);
      // Patch the record only while it still exists, so a message deleted
      // mid-processing is not resurrected by a late status write.
      const patch = (fields) => msgRef.transaction(
          (cur) => (cur ? {...cur, ...fields} : cur));
      const existing = (await msgRef.once('value')).val();
      if (!existing) return null; // deleted before processing
      if (existing.status === 'ready') return null; // retry of finished work

      await initializeFfmpeg();
      const bucket = admin.storage().bucket(object.bucket);
      const sourceName = path.basename(filePath);
      const tempSource = path.join(os.tmpdir(), sourceName);
      const tempMp3 = path.join(os.tmpdir(), `${messageId}.mp3`);
      const mp3Path = `recordings/${messageId}.mp3`;

      try {
        await patch({status: 'converting'});
        await bucket.file(filePath).download({destination: tempSource});
        await convertToMp3(tempSource, tempMp3);
        await bucket.upload(tempMp3, {
          destination: mp3Path,
          metadata: {
            contentType: 'audio/mpeg',
            metadata: {messageId, originalFile: sourceName},
          },
        });
        await bucket.file(filePath).delete();

        await patch({audioPath: mp3Path, status: 'transcribing'});
        const transcript = await transcribeBuffer(
            await fs.readFile(tempMp3), `${messageId}.mp3`);
        const summary = transcript.trim() ? await summarizeText(transcript) : '';
        await patch({transcript, summary, status: 'ready'});
      } catch (error) {
        console.error('processRecording failed for', messageId, error);
        await patch({status: 'error', error: 'Processing failed'})
            .catch(() => {});
        throw error;
      } finally {
        await Promise.all([
          fs.unlink(tempSource).catch(() => {}),
          fs.unlink(tempMp3).catch(() => {}),
        ]);
      }
      return null;
    });
