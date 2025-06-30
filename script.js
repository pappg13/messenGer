// Wait for Firebase to be ready
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, initializing Firebase...');
  
  // Wait a moment for Firebase to initialize
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('Firebase apps:', firebase.apps);
  console.log('Database:', firebase.database());
  console.log('Database ref:', firebase.database().ref());
  
  // Now initialize your database references
  window.database = firebase.database();
  window.messagesRef = database.ref('messages');
  
  console.log('Loading messages...');
  loadMessages();
  
  // Rest of your initialization code
  initializeRecording();
  // Test database write
  console.log('Testing database write...');
  const testRef = database.ref('test');
  testRef.set({ test: 'Hello Firebase' })
    .then(() => {
      console.log('Write test successful');
      return testRef.once('value');
    })
    .then(snapshot => {
    console.log('Read test:', snapshot.val());
    return testRef.remove(); // Clean up test data
  })
  .then(() => console.log('Test data cleaned up'))
  .catch(error => console.error('Database test failed:', error));
});

function initializeRecording() {
  window.mediaRecorder = null;
  window.audioChunks = [];
  
}


const storage = firebase.storage();
const storageRef = storage.ref();

async function saveMessage(blob, location) {
  console.log('Starting to save message...');
  
  try {
    // 1. Generate a unique filename with .webm extension
    const timestamp = Date.now();
    const filename = `recordings/${timestamp}.webm`;

    // 2. Create a reference to the file
    const fileRef = storageRef.child(filename);
    console.log('Uploading WebM file to:', filename);
    
    // 3. Upload the blob to Firebase Storage with explicit content type
    const uploadTask = fileRef.put(blob, {
      contentType: 'audio/webm;codecs=opus',
      customMetadata: {
        'uploadedAt': new Date().toISOString(),
        'processed': 'false'
      }
    });
    
    // 4. Wait for the upload to complete and get the download URL
    const snapshot = await uploadTask;
    console.log('Upload completed:', snapshot);
 
    
    // 5.1 Wait for the URL
    async function waitForMp3(filePath, maxAttempts = 10, delayMs = 1000) {
      const mp3Ref = storage.ref(filePath.replace('.webm', '.mp3'));
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const url = await mp3Ref.getDownloadURL();
          return url; // MP3 is ready
        } catch (err) {
          console.log(`MP3 not ready (attempt ${attempt + 1}), retrying...`);
          await new Promise(res => setTimeout(res, delayMs));
        }
      }
      throw new Error('MP3 file not available after polling');
    }


    // 5.2 Get the download URL
    const downloadURL = await snapshot.ref.getDownloadURL();
    const mp3Url = await waitForMp3(filename);
    console.log('File available at:', downloadURL);
    console.log('Full storage path:', snapshot.ref.fullPath);
    console.log('Bucket:', snapshot.ref.bucket);
    console.log('Download URL:', downloadURL);
    
    // 6. Save message data to Realtime Database
    console.log('Saving message to database...');
    const message = {
      audioUrl: mp3Url,
      location: location,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      status: 'converted',
      format: 'mp3',
      filename: filename.replace('.webm', '.mp3') // optional
    };
    
    const newMessageRef = messagesRef.push();
    await newMessageRef.set(message);
  
    console.log('Message saved with ID:', newMessageRef.key);
    return newMessageRef;
    
  } catch (error) {
    console.error('Error in saveMessage:', {
      name: error.name,
      message: error.message,
      code: error.code,
      serverResponse: error.serverResponse,
      stack: error.stack
    });
    throw error;
  }
}

let mediaStream = null;
let audioContext = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let silenceDetected = false;
let silenceTimer = null;

const recordBtn = document.getElementById("record");
const stopBtn = document.getElementById("stop");
const recordingsList = document.getElementById("recordingsList"); 

// Reference to the database
const database = firebase.database();
const messagesRef = database.ref('messages');

async function uploadAudioFile(file) {
  try {
    const storageRef = firebase.storage().ref();
    const fileRef = storageRef.child(`audio/${file.name}`);
    const uploadTask = fileRef.put(file, {
      contentType: file.type || 'audio/webm'
    });

    // Return a promise that resolves when upload is complete
    return new Promise((resolve, reject) => {
      uploadTask.on('state_changed',
        (snapshot) => {
          // Handle progress if needed
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log(`Upload is ${progress}% done`);
        },
        (error) => {
          console.error('Upload failed:', error);
          reject(error);
        },
        async () => {
          const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
          console.log('File available at', downloadURL);
          resolve(downloadURL);
        }
      );
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

// You can call this function when you have a file to upload, for example:
// const file = /* your file from file input */;
// const downloadURL = await uploadAudioFile(file);

// Function to load messages
function loadMessages() {
  console.log("Setting up messages listener..." );
  messagesRef.on('value', (snapshot) => {
    console.log("Messages updated:", snapshot.val());
    const messages = [];
    snapshot.forEach((childSnapshot) => {
      messages.push({
        id: childSnapshot.key,
        ...childSnapshot.val()
      });
    });
    updateUI(messages);
  }, (error) => {
    console.error("Error loading messages:", error);
  });
}

// Call loadMessages when the page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM loaded, loading messages...");
  loadMessages();
});


let recordingIndicator = document.createElement('div');
recordingIndicator.className = 'recording-indicator';
recordingIndicator.style.display = 'none';
document.body.appendChild(recordingIndicator);


async function getCityFromCoordinates(lat, lon) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse.php?format=json&lat=${lat}&lon=${lon}`);
    const data = await response.json();
    return data.address.city || data.address.town || 'Unknown location';
  } catch (error) {
    console.error("Error getting city:", error);
    return 'Unknown location';
  }
}

recordBtn.onclick = async () => {
  try {
    console.log('Starting recording...');
    audioChunks = [];
    silenceDetected = false;
    
    // Request audio permissions and get stream
    mediaStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      } 
    });

    // Create audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);
    
    // Create MediaRecorder with MIME type that works on iOS
    const options = { 
      mimeType: 'audio/webm',
      audioBitsPerSecond: 128000 
    };
    
    // Fallback for Safari/iOS
    if (MediaRecorder.isTypeSupported('audio/mp4')) {
      options.mimeType = 'audio/mp4';
    }
    
    mediaRecorder = new MediaRecorder(mediaStream, options);
    
    // Set up data handler
    mediaRecorder.ondataavailable = (e) => {
      console.log('Data available:', e.data.size, 'bytes');
      if (e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      console.log('Recording stopped, chunks:', audioChunks.length);
      cleanupMediaStream();
    };
    
    // Start with a small timeslice for better iOS compatibility
    mediaRecorder.start(1000); // 1 second timeslice
    isRecording = true;
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    
    // Prevent iOS from suspending the audio context
    const emptyNode = audioContext.createGain();
    emptyNode.gain.value = 0;
    emptyNode.connect(audioContext.destination);
    
    console.log('Recording started...');
    
  } catch (error) {
    console.error('Error starting recording:', error);
    alert('Error accessing microphone: ' + error.message);
    cleanupMediaStream();
    recordBtn.disabled = false;
  }
};

// Helper function to clean up media stream
function cleanupMediaStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      track.stop();
      console.log('Stopped track:', track.kind);
    });
    mediaStream = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(console.error);
    audioContext = null;
  }
}

    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.onclick = (e) => {
      console.log('Delete button clicked');
      const container = e.target.closest('.recording-item');
      console.log('Found container:', container);
      if (container) {
        const li = container.closest('li');
        console.log('Found li:', li);
        if (li) {
          console.log('Audio src:', audio.src);
          // Use the syncedMessages array directly
          const index = syncedMessages.findIndex(msg => msg.audio === audio.src);
          console.log('Found index:', index);
          if (index !== -1) {
            syncedMessages.splice(index, 1);
            console.log('Removed from synced messages');
          }
          li.remove();
          console.log('Removed from DOM');
        }
      }
    };
    

// Stop button click handler
stopBtn.onclick = async () => {
  if (!mediaRecorder || !isRecording) return;
  
  console.log('Stopping recording...');
  isRecording = false;
  stopBtn.disabled = true;
  
  try {
    // Stop the MediaRecorder
    mediaRecorder.stop();
    
    // Wait for the final data to be available
    await new Promise(resolve => {
      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped');
        resolve();
      };
      setTimeout(resolve, 1000); // Safety timeout
    });
    
    console.log('Creating blob from', audioChunks.length, 'chunks');
    const audioBlob = new Blob(audioChunks, { 
      type: mediaRecorder.mimeType 
    });
    console.log('Blob created, size:', audioBlob.size, 'bytes');
    
    if (audioBlob.size === 0) {
      throw new Error('Recorded audio is empty');
    }
    
    // Get location and save
    console.log('Getting location...');
    const location = await getUserLocation();
    console.log('Location:', location);
    
    console.log('Saving message...');
    await saveMessage(audioBlob, location);
    console.log('Message saved successfully');
    
    // Reset UI
    recordBtn.disabled = false;
    audioChunks = [];
    
  } catch (error) {
    console.error('Error stopping recording:', error);
    alert('Error saving recording: ' + error.message);
    recordBtn.disabled = false;
  } finally {
    cleanupMediaStream();
  }
};


async function getUserLocation() {
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });
    
    const { latitude, longitude } = position.coords;
    const city = await getCityFromCoordinates(latitude, longitude);
    return city;
  } catch (error) {
    console.error('Error getting location:', error);
    return 'Unknown location';
  }
}

function updateUI(messages) {
  const recordingsList = document.getElementById('recordingsList');
  recordingsList.innerHTML = ''; // Clear existing messages

  messages.forEach(message => {
    const li = document.createElement('li');
    li.className = 'recording-item';
    li.innerHTML = `
      <div class="recording-header">
        <span class="timestamp">
          ${new Date(message.timestamp).toLocaleString()} | 
          Location: ${message.location}
        </span>
        <button class="summary-btn" data-id="${message.id}">Summary</button>
        <button class="delete-btn" data-id="${message.id}">×</button>
      </div>
      <div class="audio-container">
        <audio controls crossorigin="anonymous" src="${message.audioUrl}"></audio>
      </div>
      <div class="summary-panel" data-id="${message.id}"></div>
    `;
    recordingsList.appendChild(li);
  });
}

import { openAIService } from './openai-service.js';

// Make it available globally for debugging
window.openAIService = openAIService;

// Summary button click handler
document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('summary-btn')) {
    const button = e.target;
    const messageId = button.dataset.id;
    const summaryPanel = document.querySelector(`.summary-panel[data-id="${messageId}"]`);
    const audioElement = button.closest('.recording-item').querySelector('audio');
    
    // Toggle the summary panel
    if (summaryPanel.style.display === 'block') {
      summaryPanel.style.display = 'none';
      return;
    }
    
    // Show loading state
    summaryPanel.style.display = 'block';
    summaryPanel.innerHTML = '<div class="loading">Generating summary...</div>';
    button.disabled = true;
    
    try {
      // Get the audio file
      const audioUrl = audioElement.src;
      const response = await fetch(audioUrl);
      const audioBlob = await response.blob();
      
      // Transcribe the audio
      const transcriptionResult = await window.openAIService.transcribeAudio(audioBlob);
      const transcriptionText = transcriptionResult.transcription;
      
      // Generate summary
      const summary = await window.openAIService.generateSummary(transcriptionText);
      
      // Display the summary
      summaryPanel.textContent = summary;
      
      // Store the summary in local storage for future use
      localStorage.setItem(`summary_${messageId}`, summary);
      
    } catch (error) {
      console.error('Error generating summary:', error);
      summaryPanel.textContent = 'Error generating summary. Please try again.';
    } finally {
      button.disabled = false;
    }
  }
});

// Load saved summaries when the page loads
document.addEventListener('DOMContentLoaded', () => {
  const summaryPanels = document.querySelectorAll('.summary-panel');
  summaryPanels.forEach(panel => {
    const messageId = panel.dataset.id;
    const savedSummary = localStorage.getItem(`summary_${messageId}`);
    if (savedSummary) {
      panel.textContent = savedSummary;
    }
  });
});

// Delete functionality
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('delete-btn')) {
    const messageId = e.target.dataset.id;
    database.ref(`messages/${messageId}`).remove()
      .then(() => {
        console.log('Message deleted');
      })
      .catch(error => {
        console.error('Error deleting message:', error);
      });
  }
});