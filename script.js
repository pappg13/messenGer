let mediaRecorder;
let audioChunks = [];

const recordBtn = document.getElementById("record");
const stopBtn = document.getElementById("stop");
const recordingsList = document.getElementById("recordingsList");

recordBtn.onclick = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.start();

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
    
    // Add elements to container
    container.appendChild(timeSpan);
    container.appendChild(audio);
    
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
};

// This is provided by Windsurf environment
const syncedMessages = windsurf.sync("messages", []);

function addRecording(blob) {
  const reader = new FileReader();
  reader.onloadend = () => {
    const base64 = reader.result;
    syncedMessages.push({ audio: base64, time: Date.now() });
  };
  reader.readAsDataURL(blob);
}

syncedMessages.observe(() => {
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
    audio.src = msg.audio; // this is a base64 Data URL
    
    // Add elements to container
    container.appendChild(timeSpan);
    container.appendChild(audio);
    
    // Create list item and add container
    const li = document.createElement('li');
    li.appendChild(container);
    recordingsList.insertBefore(li, recordingsList.firstChild);
  });
});