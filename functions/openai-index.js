import * as functions from 'firebase-functions';
import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {OpenAI} from 'openai';
import * as dotenv from 'dotenv';

// Load environment variables from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Initialize OpenAI with proper error handling
let openai;
try {
  const apiKey = process.env.OPENAI_API_KEY || functions.config().openai?.api_key;
  if (!apiKey) {
    throw new Error('OpenAI API key not found.');
  }
  openai = new OpenAI({apiKey});
} catch (error) {
  console.error('Failed to initialize OpenAI:', error);
  throw error;
}

// Transcribe Audio Function
export const transcribeAudio = onCall({region: 'europe-west1'}, async (request) => {
  try {
    const {audioData} = request.data;

    if (!audioData) {
      throw new HttpsError('invalid-argument', 'No audio data provided');
    }

    const audioBuffer = Buffer.from(audioData, 'base64');

    // Create a File object from the buffer, which is the expected format.
    const audioFile = new File([audioBuffer], 'recording.mp3', {
      type: 'audio/mpeg',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
    });

    return {
      transcription: transcription.text,
    };
  } catch (error) {
    console.error('Error in transcribeAudio:', error);
    throw new HttpsError('internal', 'Failed to transcribe audio', error.message);
  }
});

// Generate Summary Function
export const generateSummary = onCall({region: 'europe-west1'}, async (request) => {
  try {
    const {text} = request.data;

    if (!text) {
      throw new HttpsError('invalid-argument', 'No text provided for summarization');
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant that summarizes voice messages concisely. 
                    Format your response as follows:
                    1. Start with a brief 1-2 sentence summary
                    2. Add a blank line
                    3. List the main points, each on a new line with a bullet point
                    Keep the summary clear and to the point.`,
        },
        {
          role: 'user',
          content: `Please summarize the following text:\n\n${text}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 300,
    });

    return {
      summary: completion.choices[0]?.message?.content?.trim() || 'No summary available',
    };
  } catch (error) {
    console.error('Error in generateSummary:', error);
    throw new HttpsError('internal', 'Failed to generate summary', error.message);
  }
});
