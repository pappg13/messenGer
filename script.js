let mediaRecorder;
let audioChunks = [];

const recordBtn = document.getElementById("record");
const stopBtn = document.getElementById("stop");
const recordingsList = document.getElementById("recordingsList"); 

let recordingIndicator = document.createElement('div');
recordingIndicator.className = 'recording-indicator';
recordingIndicator.style.display = 'none';
recordBtn.parentNode.insertBefore(recordingIndicator, recordBtn);

const syncedMessages = JSON.parse(localStorage.getItem('messages') || '[]');

function saveMessages() {
  localStorage.setItem('messages', JSON.stringify(syncedMessages));
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

  mediaRecorder.onstop = () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    
    // Create a container div for better styling
    const container = document.createElement('div');
    container.className = 'recording-item';
    
    // Create timestamp
    const timestamp = new Date().toLocaleTimeString();
    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = `Recorded at: ${timestamp}`;
    
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
    recordingsList.insertBefore(li, recordingsList.firstChild); // Add to top of list
    
    // Sync across users
    addRecording(blob);
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


function addRecording(blob) {
  const reader = new FileReader();
  reader.onloadend = () => {
    const base64 = reader.result;
    syncedMessages.push({ audio: base64, time: Date.now() });
    saveMessages();
  };
  reader.readAsDataURL(blob);
}

// Replace it with a function to update the UI:
function updateUI() {
  recordingsList.innerHTML = ""; // Clear list
  syncedMessages.forEach(msg => {
    const container = document.createElement('div');
    container.className = 'recording-item';
    
    // Create timestamp
    const timestamp = new Date(msg.time).toLocaleTimeString();
    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = `Recorded at: ${timestamp}`;
    
    // Create audio element
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = msg.audio;
    
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
          const index = syncedMessages.findIndex(msg => msg.audio === audio.src);
          console.log('Found index:', index);
          if (index !== -1) {
            syncedMessages.splice(index, 1);
            saveMessages();
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
  });
}

// Call updateUI when needed:
addRecording(blob);
updateUI(); // Add this line

// And in the delete button's onclick handler:
syncedMessages.splice(index, 1);
saveMessages();
updateUI(); // Add this line