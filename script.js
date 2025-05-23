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
  console.log('Uploading audio to storage...');
  
  // Create a unique filename
  const filename = `audio/${Date.now()}.webm`;
  const audioRef = storageRef.child(filename);
  
  try {
    // Upload the blob to Firebase Storage
    const snapshot = await audioRef.put(blob);
    console.log('Uploaded audio file');
    
    // Get the download URL
    const downloadURL = await snapshot.ref.getDownloadURL();
    console.log('Got download URL:', downloadURL);
    
    // Create message with the download URL
    const message = {
      audioUrl: downloadURL,
      location: location,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };
    
    // Save message to database
    const newMessageRef = messagesRef.push();
    await newMessageRef.set(message);
    console.log('Message saved to database');
    
    return newMessageRef;
  } catch (error) {
    console.error('Error in saveMessage:', error);
    throw error;
  }
}
let mediaRecorder;
let audioChunks = [];
let syncedMessages = [];

const recordBtn = document.getElementById("record");
const stopBtn = document.getElementById("stop");
const recordingsList = document.getElementById("recordingsList"); 

// Reference to the database
const database = firebase.database();
const messagesRef = database.ref('messages');

async function saveMessage(blob, location) {
  console.log('Starting to save message...');
  
  try {
    // 1. Generate a unique filename
    const filename = `recordings/${Date.now()}.webm`;
    
    // 2. Upload the blob to Firebase Storage
    console.log('Uploading audio to storage...');
    const storageRef = firebase.storage().ref();
    const audioRef = storageRef.child(filename);
    await audioRef.put(blob);
    
    // 3. Get the download URL
    console.log('Getting download URL...');
    const audioUrl = await audioRef.getDownloadURL();
    
    // 4. Save message data to Realtime Database
    console.log('Saving message to database...');
    const message = {
      audioUrl: audioUrl,
      location: location,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };
    
    const newMessageRef = messagesRef.push();
    await newMessageRef.set(message);
    
    console.log('Message saved successfully with key:', newMessageRef.key);
    return newMessageRef;
    
  } catch (error) {
    console.error('Error in saveMessage:', {
      code: error.code,
      message: error.message,
      details: error.details
    });
    throw error;
  }
}

// Function to load messages
function loadMessages() {
  console.log('Setting up messages listener...');
  messagesRef.on('value', (snapshot) => {
    console.log('Messages updated:', snapshot.val());
    const messages = [];
    snapshot.forEach((childSnapshot) => {
      messages.push({
        id: childSnapshot.key,
        ...childSnapshot.val()
      });
    });
    updateUI(messages);
  }, (error) => {
    console.error('Error loading messages:', error);
  });
}

// Call loadMessages when the page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, loading messages...');
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
    console.error('Error getting city:', error);
    return 'Unknown location';
  }
}

recordBtn.onclick = async () => {
  try {
    audioChunks = [];  // Clear previous chunks
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    // Set up mediaRecorder event handlers
    mediaRecorder.ondataavailable = e => {
      audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      console.log('MediaRecorder stopped, processing recording...');
      try {
        if (audioChunks.length === 0) {
          throw new Error('No audio data recorded');
        }
        
        console.log('Creating audio blob...');
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        
        // Get user's location
        console.log('Getting user location...');
        const location = await getUserLocation();
        console.log('Location:', location);

        // Save the message with the blob
        console.log('Saving message to Firebase...');
        const messageRef = await saveMessage(blob, location);
        console.log('Message saved with key:', messageRef.key);
        
        // Clear the chunks for the next recording
        audioChunks = [];
        console.log('Audio chunks cleared');
        
      } catch (error) {
        console.error('Error in mediaRecorder.onstop:', error);
        if (error.code) {
          console.error('Firebase error:', {
            code: error.code,
            message: error.message,
            details: error.details
          });
        }
      }
    };

    // Start recording
    mediaRecorder.start();
    recordingIndicator.style.display = 'inline-block';
    recordBtn.disabled = true;
    stopBtn.disabled = false;

  } catch (error) {
    console.error('Error starting recording:', error);
  }
};
    
    
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
    

stopBtn.onclick = () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    recordingIndicator.style.display = 'none';
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
      <span class="timestamp">
        ${new Date(message.timestamp).toLocaleString()} | 
        Location: ${message.location}
      </span>
      <audio controls crossorigin="anonymous" src="${message.audioUrl}"></audio>
      <button class="delete-btn" data-id="${message.id}">×</button>
    `;
    recordingsList.appendChild(li);
  });
}

// Delete functionality
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('delete-btn')) {
    const messageId = e.target.dataset.id;
    database.ref(`messages/${messageId}`).remove()
      .then(() => {
        console.log('Message deleted');
      })
      .catch((error) => {
        console.error('Error deleting message:', error);
      });
  }
});

// Stop button handler
stopBtn.onclick = () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    recordingIndicator.style.display = 'none';
  }
};