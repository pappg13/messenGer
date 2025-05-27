/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */


const { onObjectFinalized } = require("firebase-functions/v2/storage");
const admin = require("firebase-admin");
const path = require("path");
const os = require("os");
const fs = require("fs").promises;

admin.initializeApp();

const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

const convertWebmToMp3Handler = async (object) => {
  if (!object || !object.bucket || !object.name) {
    console.error("Invalid object provided");
    return null;
  }

  const fileBucket = object.bucket;
  const filePath = object.name;
  const contentType = object.contentType || "";
  const metadata = object.metadata || {};

  // Exit if this is not a WebM file
  if (!contentType.startsWith("audio/webm")) {
    console.log("Not a WebM file, skipping conversion");
    return null;
  }

  // Exit if this is already an MP3 file (in case of retries)
  if (filePath.endsWith(".mp3")) {
    console.log("Already an MP3 file, skipping");
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
    console.log("WebM file downloaded to", tempFilePath);

    // Convert to MP3
    await new Promise((resolve, reject) => {
      ffmpeg(tempFilePath)
          .output(targetTempFilePath)
          .audioCodec("libmp3lame")
          .audioBitrate("192k")
          .on("end", () => {
            console.log("Conversion to MP3 completed");
            resolve();
          })
          .on("error", (err) => {
            console.error("Error converting to MP3:", err);
            reject(err);
          })
          .run();
    });

    // Upload the MP3 file
    const destination = filePath.replace(/\.webm$/, ".mp3");
    await bucket.upload(targetTempFilePath, {
      destination: destination,
      metadata: {
        metadata: {
          ...metadata,
          originalFile: fileName,
          converted: true,
        },
        contentType: "audio/mpeg",
      },
    });
    console.log("MP3 file uploaded to", destination);

    // Delete the original WebM file
    await bucket.file(filePath).delete();
    console.log("Original WebM file deleted");

    // Clean up temporary files
    await Promise.all([
      fs.unlink(tempFilePath).catch(console.error),
      fs.unlink(targetTempFilePath).catch(console.error),
    ]);

    return null;
  } catch (error) {
    console.error("Error during conversion:", error);
    // Clean up temporary files in case of error
    try {
      await Promise.all([
        fs.unlink(tempFilePath).catch(console.error),
        fs.unlink(targetTempFilePath).catch(console.error),
      ]);
    } catch (cleanupError) {
      console.error("Error cleaning up temporary files:", cleanupError);
    }
    throw error;
  }
};

// Export the function to be triggered by Firebase Storage
exports.convertWebmToMp3 = onObjectFinalized(
    {
      region: "europe-west1",
      runtime: "nodejs22",
    },
    convertWebmToMp3Handler
  );
