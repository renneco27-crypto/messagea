// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "DEBUG_LOG") {
    const debugContent = document.getElementById('debug-content');
    if (debugContent) {
      const time = new Date().toLocaleTimeString();
      debugContent.textContent += `[${time}] ${request.message}\n`;
      debugContent.scrollTop = debugContent.scrollHeight;
    }
  }
});

// Check active tab status
function checkBotStatus() {
  const debugContent = document.getElementById('debug-content');
  
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) {
      if (debugContent) {
        debugContent.textContent = 'No active tab found\n';
      }
      return;
    }
    
    const tabUrl = tabs[0].url || '';
    
    if (tabUrl.includes('messenger.com')) {
      if (debugContent) {
        debugContent.innerHTML = '<span class="status-info">Checking connection to Messenger bot...</span>\n';
      }
      
      // Ping the content script
      chrome.tabs.sendMessage(tabs[0].id, {type: "PING"}, (response) => {
        if (chrome.runtime.lastError) {
          if (debugContent) {
            debugContent.innerHTML = '<span class="status-error">Bot not active. Click refresh below.</span>\n';
          }
        } else if (response && response.botReady) {
          if (debugContent) {
            debugContent.innerHTML = '<span class="status-connected">Bot connected! Monitoring messages...</span>\n';
          }
        } else {
          if (debugContent) {
            debugContent.innerHTML = '<span class="status-error">Unexpected response from bot</span>\n';
          }
        }
      });
    } else {
      if (debugContent) {
        debugContent.innerHTML = '<span class="status-info">Switch to Messenger tab and click refresh</span>\n';
      }
    }
  });
}

// Refresh Messenger tab
function refreshMessenger() {
  const debugContent = document.getElementById('debug-content');
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('messenger.com')) {
      chrome.tabs.reload(tabs[0].id);
      if (debugContent) {
        debugContent.innerHTML = '<span class="status-info">Refreshing Messenger...</span>\n';
        setTimeout(checkBotStatus, 3000);
      }
    } else {
      if (debugContent) {
        debugContent.innerHTML = '<span class="status-error">Not on Messenger tab</span>\n';
      }
    }
  });
}

// Check immediately
checkBotStatus();

// Add refresh button event listener
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(checkBotStatus, 500);
  
  // Add refresh button
  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'Refresh Messenger';
  refreshBtn.style.cssText = `
    margin-top: 10px;
    padding: 10px 15px;
    background: #4267B2;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
  `;
  refreshBtn.addEventListener('click', refreshMessenger);
  document.body.appendChild(refreshBtn);
});