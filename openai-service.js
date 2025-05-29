import { functions, httpsCallable } from './firebase.js';

export class OpenAIService {
  constructor() {
    // No API key needed in the frontend anymore
  }

  // Transcribe audio using Firebase Function
  async transcribeAudio(audioBlob) {
    try {
      // Convert blob to base64 for transmission
      const base64data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(audioBlob);
      });

      const transcribeAudio = httpsCallable(functions, 'transcribeAudio');
      const result = await transcribeAudio({ audioData: base64data });
      return result.data.transcription;
    } catch (error) {
      console.error('Error in transcribeAudio:', error);
      throw new Error('Failed to transcribe audio. Please try again.');
    }
  }

  // Generate summary using Firebase Function
  async generateSummary(text) {
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('No text provided for summarization');
      }

      const generateSummary = httpsCallable(functions, 'generateSummary');
      const result = await generateSummary({ 
        text,
        // Include any prompt configuration here if needed
        prompt: `You are a helpful assistant that summarizes voice messages concisely. 
              
Format your response as follows:
1. Start with a brief 1-2 sentence summary
2. Add a blank line
3. List the main points, each on a new line with a bullet point

Keep the summary clear and to the point.`
      });
      
      return result.data.summary;
    } catch (error) {
      console.error('Error in generateSummary:', error);
      throw new Error('Failed to generate summary. Please try again.');
    }
  }
}

// Create and export a singleton instance
export const openAIService = new OpenAIService();