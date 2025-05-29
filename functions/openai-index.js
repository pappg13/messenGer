const functions = require('firebase-functions');
const {initializeApp} = require('firebase-admin/app');
const {onCall} = require('firebase-functions/v2/https');
const {OpenAI} = require('openai');

// Initialize Firebase Admin
initializeApp();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.generateSummary = onCall(async (request) => {
  try {
    const {text} = request.data;

    if (!text) {
      throw new Error('No text provided for summarization');
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
          content: `You are a helpful assistant that summarizes voice messages concisely.
          Format your response as follows:
          1. Start with a brief 1-2 sentence summary
          2. Add a blank line
          3. List the main points, each on a new line with a bullet point
          
          Keep the summary clear and to the point.`,
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
    throw new functions.https.HttpsError(
        'internal',
        'Failed to generate summary',
        error.message,
    );
  }
});
