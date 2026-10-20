import {OpenAI, toFile} from 'openai';
import * as dotenv from 'dotenv';

// Load environment variables from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

let openai;

/**
 * Lazily creates the OpenAI client so a missing key only fails the
 * recordings that need it, not the whole function bundle.
 * @return {OpenAI} client
 */
function getClient() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not found.');
    }
    openai = new OpenAI({apiKey});
  }
  return openai;
}

/**
 * Transcribes an audio buffer with Whisper.
 * @param {Buffer} buffer audio bytes
 * @param {string} filename name with a correct extension (e.g. x.mp3)
 * @return {Promise<string>} transcript text
 */
export async function transcribeBuffer(buffer, filename) {
  const file = await toFile(buffer, filename);
  const transcription = await getClient().audio.transcriptions.create({
    file,
    model: 'whisper-1',
  });
  return transcription.text;
}

/**
 * Summarises a transcript in the language it was spoken in.
 * @param {string} text transcript
 * @return {Promise<string>} short summary
 */
export async function summarizeText(text) {
  const completion = await getClient().chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: `You are a helpful assistant that summarizes voice messages concisely.
                  Write a brief summary of 1-2 sentences, as plain text with no
                  bullet points or headings. The summary must be in the same
                  language as the voice message.`,
      },
      {
        role: 'user',
        content: `Please summarize the following text:\n\n${text}`,
      },
    ],
    temperature: 0.5,
    max_tokens: 200,
  });
  return completion.choices[0]?.message?.content?.trim() || '';
}
