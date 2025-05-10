// LiteChat - Lightweight Gaming Communication App
// server.js - Backend Server

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configuration
const PORT = process.env.PORT || 3000;
const MAX_CONNECTIONS_PER_ROOM = 50;
const PING_INTERVAL = 30000; // 30 seconds

// Initialize Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store for rooms and users
const rooms = new Map();
const users = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  const userId = crypto.randomBytes(16).toString('hex');
  let currentRoom = null;
  let username = null;
  
  users.set(userId, { ws, username, currentRoom });
  
  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          handleJoinRoom(userId, data.roomId, data.username);
          break;
        case 'leave':
          handleLeaveRoom(userId);
          break;
        case 'message':
          handleMessage(userId, data.content);
          break;
        case 'audio':
          handleAudioData(userId, data.content);
          break;
        case 'pong':
          users.get(userId).lastPong = Date.now();
          break;
        default:
          console.log(`Unknown message type: ${data.type}`);
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    handleLeaveRoom(userId);
    users.delete(userId);
  });
  
  // Send initial connection acknowledgment
  ws.send(JSON.stringify({
    type: 'connected',
    userId: userId
  }));
  
  // Set up ping interval to keep connection alive and detect stale connections
  users.get(userId).lastPong = Date.now();
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
      
      // Check if client hasn't responded for too long
      const user = users.get(userId);
      if (user && Date.now() - user.lastPong > PING_INTERVAL * 2) {
        ws.terminate();
        clearInterval(pingInterval);
      }
    } else {
      clearInterval(pingInterval);
    }
  }, PING_INTERVAL);
});

// Room management functions
function handleJoinRoom(userId, roomId, requestedUsername) {
  const user = users.get(userId);
  if (!user) return;
  
  // Leave current room if in one
  if (user.currentRoom) {
    handleLeaveRoom(userId);
  }
  
  // Create room if it doesn't exist
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  
  const room = rooms.get(roomId);
  
  // Check if room is full
  if (room.size >= MAX_CONNECTIONS_PER_ROOM) {
    user.ws.send(JSON.stringify({
      type: 'error',
      message: 'Room is full'
    }));
    return;
  }
  
  // Sanitize and ensure unique username
  let username = requestedUsername.slice(0, 20).trim() || 'User';
  let nameCount = 1;
  
  // Check if username is taken in this room
  let usernameTaken = Array.from(room).some(memberId => {
    const member = users.get(memberId);
    return member && member.username === username;
  });
  
  // Append number if username is taken
  while (usernameTaken) {
    const newName = `${username}${nameCount}`;
    nameCount++;
    
    usernameTaken = Array.from(room).some(memberId => {
      const member = users.get(memberId);
      return member && member.username === newName;
    });
    
    if (!usernameTaken) {
      username = newName;
    }
  }
  
  // Add user to room
  room.add(userId);
  user.currentRoom = roomId;
  user.username = username;
  
  // Notify user of successful join
  user.ws.send(JSON.stringify({
    type: 'joined',
    roomId,
    username,
    userCount: room.size
  }));
  
  // Notify room of new user
  broadcastToRoom(roomId, {
    type: 'userJoined',
    username,
    userCount: room.size
  }, userId);
  
  // Send list of users in room
  const userList = Array.from(room)
    .map(id => {
      const member = users.get(id);
      return member ? member.username : null;
    })
    .filter(Boolean);
  
  user.ws.send(JSON.stringify({
    type: 'userList',
    users: userList
  }));
}

function handleLeaveRoom(userId) {
  const user = users.get(userId);
  if (!user || !user.currentRoom) return;
  
  const roomId = user.currentRoom;
  const room = rooms.get(roomId);
  
  if (room) {
    room.delete(userId);
    
    // Notify room of user leaving
    broadcastToRoom(roomId, {
      type: 'userLeft',
      username: user.username,
      userCount: room.size
    });
    
    // Delete room if empty
    if (room.size === 0) {
      rooms.delete(roomId);
    }
  }
  
  user.currentRoom = null;
}

function handleMessage(userId, content) {
  const user = users.get(userId);
  if (!user || !user.currentRoom) return;
  
  // Simple text message handling
  const roomId = user.currentRoom;
  
  // Don't send empty messages
  if (!content || !content.trim()) return;
  
  // Broadcast message to room
  broadcastToRoom(roomId, {
    type: 'message',
    username: user.username,
    content: content.slice(0, 1000), // Limit message size
    timestamp: Date.now()
  });
}

function handleAudioData(userId, audioData) {
  const user = users.get(userId);
  if (!user || !user.currentRoom) return;
  
  // Relay audio data to other users in the room
  broadcastToRoom(user.currentRoom, {
    type: 'audio',
    username: user.username,
    content: audioData
  }, userId);
}

function broadcastToRoom(roomId, message, excludeUserId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const messageString = JSON.stringify(message);
  
  room.forEach(userId => {
    if (excludeUserId && userId === excludeUserId) return;
    
    const user = users.get(userId);
    if (user && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(messageString);
    }
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`LiteChat server running on port ${PORT}`);
});