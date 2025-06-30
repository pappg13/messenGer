/**
 * Import function triggers from their respective submodules:
 */

import {transcribeAudio, generateSummary} from './openai-index.js';

import {onObjectFinalized} from 'firebase-functions/v2/storage';
import {setGlobalOptions} from 'firebase-functions/v2';
import admin from 'firebase-admin';
import path from 'path';
import os from 'os';
import {promises as fs} from 'fs';

// Set the maximum instances and timeout for the function
setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: '2GiB',
  region: 'europe-west1',
  cors: [
    'http://127.0.0.1:5501',
    'https://pappg13.github.io',
    'http://localhost:5000',
    'http://localhost:5501',
    'http://localhost:3000',
    'http://localhost:8080',
  ],
});

if (admin.apps.length === 0) {
  admin.initializeApp();
}

// Initialize ffmpeg
let ffmpeg;
let ffmpegInitialized = false;

async function initializeFfmpeg() {
  if (ffmpegInitialized) return;
  const ffmpegModule = await import('fluent-ffmpeg');
  const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;
  ffmpeg = ffmpegModule.default;
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpegInitialized = true;
}

const convertWebmToMp3 = onObjectFinalized(
    {
      region: 'europe-west1',
      timeoutSeconds: 540,
      memory: '2GiB',
    },
    async (event) => {
      await initializeFfmpeg();
      const object = event.data;
      if (!object || !object.bucket || !object.name) {
        console.error('Invalid object provided');
        return null;
      }

      const fileBucket = object.bucket;
      const filePath = object.name;
      const contentType = object.contentType || '';
      const metadata = object.metadata || {};

      // Exit if this is not a WebM file
      if (!contentType.startsWith('audio/webm')) {
        console.log('Not a WebM file, skipping conversion');
        return null;
      }

      // Exit if this is already an MP3 file (in case of retries)
      if (filePath.endsWith('.mp3')) {
        console.log('Already an MP3 file, skipping');
        return null;
      }

      // Get the file name
      const fileName = path.basename(filePath);
      const baseName = path.basename(fileName, path.extname(fileName));
      const tempFilePath = path.join(os.tmpdir(), fileName);
      const targetTempFilePath = path.join(os.tmpdir(), `${baseName}.mp3`);
      const bucket = admin.storage().bucket(fileBucket);

      try {
        // Download the WebM file to a temporary location
        await bucket.file(filePath).download({destination: tempFilePath});
        console.log('WebM file downloaded to', tempFilePath);

        // Convert to MP3
        await new Promise((resolve, reject) => {
          ffmpeg(tempFilePath)
              .output(targetTempFilePath)
              .audioCodec('libmp3lame')
              .audioBitrate('192k')
              .on('end', () => {
                console.log('Conversion to MP3 completed');
                resolve();
              })
              .on('error', (err) => {
                console.error('Error converting to MP3:', err);
                reject(err);
              })
              .run();
        });

        // Upload the MP3 file
        const destination = filePath.replace(/\.webm$/, '.mp3');
        await bucket.upload(targetTempFilePath, {
          destination: destination,
          metadata: {
            metadata: {
              ...metadata,
              originalFile: fileName,
              converted: true,
            },
            contentType: 'audio/mpeg',
          },
        });
        console.log('MP3 file uploaded to', destination);

        // Delete the original WebM file
        await bucket.file(filePath).delete();
        console.log('Original WebM file deleted');

        // Clean up temporary files
        await Promise.all([
          fs.unlink(tempFilePath).catch(console.error),
          fs.unlink(targetTempFilePath).catch(console.error),
        ]);

        return null;
      } catch (error) {
        console.error('Error during conversion:', error);
        // Clean up temporary files in case of error
        try {
          await Promise.all([
            fs.unlink(tempFilePath).catch(console.error),
            fs.unlink(targetTempFilePath).catch(console.error),
          ]);
        } catch (cleanupError) {
          console.error('Error cleaning up temporary files:', cleanupError);
        }
        throw error;
      }
    });

// Export all functions to be triggered by Firebase
export {convertWebmToMp3, transcribeAudio, generateSummary};
