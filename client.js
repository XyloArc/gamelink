// public/client.js
fs.writeFileSync(path.join(__dirname, 'public', 'client.js'), `
// LiteChat Client
// Optimized for low CPU/GPU usage

// DOM Elements
const elements = {
  loginScreen: document.getElementById('loginScreen'),
  chatScreen: document.getElementById('chatScreen'),
  username: document.getElementById('username'),
  roomId: document.getElementById('roomId'),
  joinBtn: document.getElementById('joinBtn'),
  messages: document.getElementById('messages'),
  userList: document.getElementById('userList'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  voiceBtn: document.getElementById('voiceBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
  roomDisplay: document.getElementById('roomDisplay'),
  notification: document.getElementById('notification')
};

// App State
const state = {
  userId: null,
  username: null,
  roomId: null,
  ws: null,
  wsConnected: false,
  mediaRecorder: null,
  isRecording: false,
  audioContext: null,
  audioWorkletNode: null,
  audioInputNode: null,
  reconnectAttempts: 0,
  reconnectDelay: 1000, // Starting delay in ms
  maxReconnectDelay: 30000, // Max delay of 30 seconds
  reconnectTimeout: null
};

// Initialize application
function init() {
  bindEventListeners();
  
  // Check if audio context is supported
  if (window.AudioContext || window.webkitAudioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  // Generate a random room ID if not provided
  const randomId = Math.random().toString(36).substring(2, 8);
  elements.roomId.placeholder = \`Enter room ID or use "\${randomId}"\`;
  
  // Try to retrieve last used username from localStorage
  const lastUsername = localStorage.getItem('litechat-username');
  if (lastUsername) {
    elements.username.value = lastUsername;
  }
}

// Event Listeners
function bindEventListeners() {
  // Join button click
  elements.joinBtn.addEventListener('click', handleJoin);
  
  // Join on enter key
  elements.roomId.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoin();
  });
  
  // Send message button
  elements.sendBtn.addEventListener('click', () => {
    sendMessage();
  });
  
  // Send on enter, new line on shift+enter
  elements.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // Leave button
  elements.leaveBtn.addEventListener('click', () => {
    leaveRoom();
  });
  
  // Voice chat button - toggle recording
  elements.voiceBtn.addEventListener('click', toggleVoiceChat);
  
  // Handle window unload/close
  window.addEventListener('beforeunload', () => {
    if (state.ws && state.wsConnected) {
      state.ws.close();
    }
  });
}

// WebSocket Connection
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = \`\${protocol}//\${window.location.host}\`;
  
  state.ws = new WebSocket(wsUrl);
  
  state.ws.onopen = () => {
    state.wsConnected = true;
    state.reconnectAttempts = 0;
    state.reconnectDelay = 1000;
    console.log('WebSocket connected');
    
    // If reconnecting while in a room, rejoin
    if (state.roomId && state.username) {
      state.ws.send(JSON.stringify({
        type: 'join',
        roomId: state.roomId,
        username: state.username
      }));
    }
  };
  
  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (err) {
      console.error('Error parsing message:', err);
    }
  };
  
  state.ws.onclose = () => {
    state.wsConnected = false;
    console.log('WebSocket disconnected');
    
    // Attempt to reconnect with exponential backoff
    if (!state.reconnectTimeout) {
      state.reconnectTimeout = setTimeout(() => {
        state.reconnectTimeout = null;
        if (state.reconnectAttempts < 10) { // Limit to 10 attempts
          state.reconnectAttempts++;
          state.reconnectDelay = Math.min(state.reconnectDelay * 1.5, state.maxReconnectDelay);
          showNotification('Connection lost. Reconnecting...');
          connectWebSocket();
        } else {
          showNotification('Connection lost. Please refresh the page.');
        }
      }, state.reconnectDelay);
    }
  };
  
  state.ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// Handle server messages
function handleServerMessage(data) {
  switch (data.type) {
    case 'connected':
      state.userId = data.userId;
      break;
      
    case 'joined':
      state.roomId = data.roomId;
      state.username = data.username;
      elements.roomDisplay.textContent = \`Room: \${data.roomId} (\${data.userCount})\`;
      showChatScreen();
      showNotification(\`Joined room \${data.roomId} as \${data.username}\`);
      
      // Save username to localStorage
      localStorage.setItem('litechat-username', data.username);
      break;
      
    case 'userJoined':
      elements.roomDisplay.textContent = \`Room: \${state.roomId} (\${data.userCount})\`;
      addSystemMessage(\`\${data.username} joined the room\`);
      break;
      
    case 'userLeft':
      elements.roomDisplay.textContent = \`Room: \${state.roomId} (\${data.userCount})\`;
      addSystemMessage(\`\${data.username} left the room\`);
      break;
      
    case 'userList':
      updateUserList(data.users);
      break;
      
    case 'message':
      addChatMessage(data);
      break;
      
    case 'audio':
      playAudio(data);
      break;
      
    case 'error':
      showNotification(data.message);
      break;
      
    case 'ping':
      // Respond to keep connection alive
      if (state.ws && state.wsConnected) {
        state.ws.send(JSON.stringify({ type: 'pong' }));
      }
      break;
      
    default:
      console.log('Unknown message type:', data.type);
  }
}

// Join a room
function handleJoin() {
  const username = elements.username.value.trim() || 'User';
  const roomId = elements.roomId.value.trim() || elements.roomId.placeholder.split('"')[1];
  
  if (!state.wsConnected) {
    connectWebSocket();
    
    // Wait for connection before joining
    const joinInterval = setInterval(() => {
      if (state.wsConnected) {
        clearInterval(joinInterval);
        sendJoinRequest(username, roomId);
      }
    }, 100);
  } else {
    sendJoinRequest(username, roomId);
  }
}

function sendJoinRequest(username, roomId) {
  state.ws.send(JSON.stringify({
    type: 'join',
    roomId: roomId,
    username: username
  }));
}

// Leave current room
function leaveRoom() {
  if (state.ws && state.wsConnected && state.roomId) {
    state.ws.send(JSON.stringify({
      type: 'leave'
    }));
    
    // Stop any ongoing recording
    stopVoiceRecording();
    
    // Clear chat and return to login screen
    elements.messages.innerHTML = '';
    elements.userList.innerHTML = '';
    showLoginScreen();
    
    state.roomId = null;
  }
}

// Send text message
function sendMessage() {
  const message = elements.messageInput.value.trim();
  
  if (message && state.ws && state.wsConnected && state.roomId) {
    state.ws.send(JSON.stringify({
      type: 'message',
      content: message
    }));
    
    elements.messageInput.value = '';
  }
}

// Toggle voice recording
function toggleVoiceChat() {
  if (state.isRecording) {
    stopVoiceRecording();
  } else {
    startVoiceRecording();
  }
}

// Start voice recording
function startVoiceRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showNotification('Voice chat is not supported in your browser');
    return;
  }
  
  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(stream => {
      elements.voiceBtn.classList.add('active');
      elements.voiceBtn.textContent = '🔴';
      state.isRecording = true;
      
      // Create media recorder with low resource usage settings
      const options = {
        audioBitsPerSecond: 32000, // Lower bitrate
        mimeType: getPreferredMimeType()
      };
      
      try {
        state.mediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        // Fallback if options aren't supported
        state.mediaRecorder = new MediaRecorder(stream);
      }
      
      // Process audio data
      state.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && state.ws && state.wsConnected) {
          // Convert to base64 and send
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = reader.result.split(',')[1];
            state.ws.send(JSON.stringify({
              type: 'audio',
              content: base64data
            }));
          };
          reader.readAsDataURL(event.data);
        }
      };
      
      // Set up chunking interval (shorter for more real-time feel)
      state.mediaRecorder.start(200);
    })
    .catch(error => {
      console.error('Error accessing microphone:', error);
      showNotification('Could not access microphone');
    });
}

// Stop voice recording
function stopVoiceRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    state.mediaRecorder = null;
    
    elements.voiceBtn.classList.remove('active');
    elements.voiceBtn.textContent = '🎤';
    state.isRecording = false;
  }
}

// Play received audio
function playAudio(data) {
  try {
    // Convert base64 to audio and play
    const audio = new Audio(\`data:audio/webm;base64,\${data.content}\`);
    audio.volume = 0.8;
    
    // Low resource playback
    audio.onloadedmetadata = () => {
      // Only play if duration is reasonable to avoid memory issues
      if (audio.duration < 10) { // Less than 10 seconds
        audio.play().catch(err => console.error('Error playing audio:', err));
      }
    };
    
    // Clean up after playing
    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
    };
  } catch (err) {
    console.error('Error playing audio:', err);
  }
}

// Get preferred audio MIME type
function getPreferredMimeType() {
  const types = [
    'audio/webm;codecs=opus', // Most efficient for web
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4'
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  
  return '';
}

// UI Functions
function showLoginScreen() {
  elements.loginScreen.classList.remove('hidden');
  elements.chatScreen.classList.add('hidden');
}

function showChatScreen() {
  elements.loginScreen.classList.add('hidden');
  elements.chatScreen.classList.remove('hidden');
  elements.messageInput.focus();
}

function updateUserList(users) {
  elements.userList.innerHTML = '';
  
  users.forEach(username => {
    const li = document.createElement('li');
    li.textContent = username;
    if (username === state.username) {
      li.style.fontWeight = 'bold';
    }
    elements.userList.appendChild(li);
  });
}

function addChatMessage(data) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  
  const header = document.createElement('div');
  header.className = 'header';
  
  const usernameSpan = document.createElement('span');
  usernameSpan.className = 'username';
  usernameSpan.textContent = data.username;
  
  const timestamp = document.createElement('span');
  timestamp.className = 'timestamp';
  timestamp.textContent = formatTime(data.timestamp);
  
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = data.content;
  
  header.appendChild(usernameSpan);
  header.appendChild(timestamp);
  
  messageDiv.appendChild(header);
  messageDiv.appendChild(content);
  
  elements.messages.appendChild(messageDiv);
  scrollToBottom();
}

function addSystemMessage(text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system';
  
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = text;
  content.style.color = '#72767d';
  content.style.fontStyle = 'italic';
  
  messageDiv.appendChild(content);
  elements.messages.appendChild(messageDiv);
  scrollToBottom();
}

function scrollToBottom() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showNotification(message) {
  elements.notification.textContent = message;
  elements.notification.classList.remove('hidden');
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    elements.notification.classList.add('hidden');
  }, 3000);
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

// Start WebSocket connection
connectWebSocket();