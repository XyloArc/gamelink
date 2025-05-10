const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let tray = null;
let serverProcess = null;

// Start the express server
function startServer() {
  const serverPath = path.join(__dirname, 'server.js');
  serverProcess = spawn('node', [serverPath]);
  
  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error(`Server error: ${data}`);
  });
  
  serverProcess.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
  });
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../build/icon.png')
  });

  // Wait a moment for the server to start
  setTimeout(() => {
    // Load the app
    mainWindow.loadURL('http://localhost:3000');
  }, 1000);

  // Open DevTools in development mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Create system tray
  tray = new Tray(path.join(__dirname, '../build/icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open LiteChat', click: () => mainWindow.show() },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setToolTip('LiteChat');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    return true;
  });
}

// Initialize the app
app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit properly on exit
app.on('before-quit', () => {
  app.isQuitting = true;
  
  // Kill the server process when app quits
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
