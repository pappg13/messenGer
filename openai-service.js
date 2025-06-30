// openai-service.js
class OpenAIService {
  constructor() {
    if (!window.firebaseApp) {
      throw new Error('Firebase not initialized. Make sure firebase.js is loaded first.');
    }
    // Initialize functions with the correct region
    this.functions = firebase.app().functions('europe-west1');
    
    this.transcribeAudioCallable = this.functions.httpsCallable('transcribeAudio');
    this.generateSummaryCallable = this.functions.httpsCallable('generateSummary');
  }

  async transcribeAudio(audioBlob) {
    try {
      const base64Audio = await this._blobToBase64(audioBlob);
      const result = await this.transcribeAudioCallable({ audioData: base64Audio });
      return result.data;
    } catch (error) {
      console.error('Error in transcribeAudio:', error);
      throw error;
    }
  }
  
  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async generateSummary(text) {
    try {
      const result = await this.generateSummaryCallable({ text });
      return result.data.summary; // Return the summary property directly
    } catch (error) {
      console.error('Error in generateSummary:', error);
      throw error;
    }
  }
}

// Export as a singleton
export const openAIService = new OpenAIService();