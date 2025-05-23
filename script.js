let mediaRecorder;
let audioChunks = [];
let syncedMessages = [];

const recordBtn = document.getElementById("record");
const stopBtn = document.getElementById("stop");
const recordingsList = document.getElementById("recordingsList"); 

let recordingIndicator = document.createElement('div');
recordingIndicator.className = 'recording-indicator';
recordingIndicator.style.display = 'none';
recordBtn.parentNode.insertBefore(recordingIndicator, recordBtn);

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
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.start();
  recordingIndicator.style.display = 'inline-block';

  mediaRecorder.ondataavailable = e => {
    audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    
    // Get user's location
    const location = await getUserLocation();
    
    // Create a container div for better styling
    const container = document.createElement('div');
    container.className = 'recording-item';
    
    // Create timestamp
    const timestamp = new Date().toLocaleTimeString();
    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = `Recorded at: ${timestamp} | Location: ${location}`;
    
    // Create audio element
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = url;
    
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
    
    // Add elements to container
    container.appendChild(timeSpan);
    container.appendChild(audio);
    container.appendChild(deleteBtn);
    
    // Create list item and add container
    const li = document.createElement('li');
    li.appendChild(container);
    recordingsList.insertBefore(li, recordingsList.firstChild);
  };

  recordBtn.disabled = true;
  stopBtn.disabled = false;
};

stopBtn.onclick = () => {
  mediaRecorder.stop();
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  recordingIndicator.style.display = 'none';
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