import { OPENAI_API_KEY } from './config.js';

class OpenAIService {
  constructor() {
    if (!OPENAI_API_KEY) {
      console.error('OpenAI API key is not configured. Please check your config.js file.');
      return;
    }
    this.apiKey = OPENAI_API_KEY;
  }

  // Transcribe audio using Whisper API
  async transcribeAudio(audioBlob) {
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.mp3');
      formData.append('model', 'whisper-1');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('OpenAI API Error:', error);
        throw new Error(error.error?.message || 'Failed to transcribe audio');
      }

      const data = await response.json();
      return data.text;
    } catch (error) {
      console.error('Error in transcribeAudio:', error);
      throw new Error('Failed to transcribe audio. Please try again.');
    }
  }

  // Generate summary using GPT-3.5-turbo
  async generateSummary(text) {
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('No text provided for summarization');
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `You are a helpful assistant that summarizes voice messages concisely. 
              
              Format your response as follows:
              1. Start with a brief 1-2 sentence summary
              2. Add a blank line
              3. List the main points, each on a new line with a bullet point
              
              Keep the summary clear and to the point.`
            },
            {
              role: 'user',
              content: `Please provide a summary of the following voice message. First give a brief 1-2 sentence overview, then list the main points below. Ensure proper line breaks between sections.\n\n${text}`
            }
          ],
          temperature: 0.5,
          max_tokens: 100
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('OpenAI API Error:', error);
        throw new Error(error.error?.message || 'Failed to generate summary');
      }

      const data = await response.json();
      return data.choices[0]?.message?.content.trim() || 'No summary available';
    } catch (error) {
      console.error('Error in generateSummary:', error);
      throw new Error('Failed to generate summary. Please try again.');
    }
  }
}

// Export the class
export { OpenAIService };
