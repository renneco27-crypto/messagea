// Check if bot is active in current tab
function checkBotStatus() {
  const debugContent = document.getElementById('debug-content');
  if (debugContent) {
    debugContent.innerHTML = '<span class="status-info">Checking connection...</span>';
  }
  
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) {
      if (debugContent) debugContent.innerHTML = '<span class="status-error">No active tab found</span>';
      return;
    }
    
    // Check if we're on Messenger or Facebook
    if (tabs[0].url && (tabs[0].url.includes('messenger.com') || tabs[0].url.includes('facebook.com'))) {
      // Try to ping the content script with retry
      pingContentScript(tabs[0].id, 3);
    } else {
      if (debugContent) debugContent.innerHTML = '<span class="status-info">Go to Messenger or Facebook to see activity</span>';
    }
  });
}

function pingContentScript(tabId, retries) {
  const debugContent = document.getElementById('debug-content');
  
  chrome.tabs.sendMessage(tabId, {type: "PING"}, (response) => {
    if (chrome.runtime.lastError || !response || !response.botReady) {
      if (retries > 0) {
        // Retry with delay
        setTimeout(() => pingContentScript(tabId, retries - 1), 1000);
        return;
      }
      
      if (debugContent) {
        debugContent.innerHTML = 
          '<span class="status-error">Bot not active. Click refresh below.</span>';
      }
    } else {
      if (debugContent) {
        debugContent.innerHTML = 
          '<span class="status-connected">Bot connected! Monitoring messages...</span>';
      }
    }
  });
}

// Refresh Messenger tab
function refreshMessenger() {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (tabs[0] && (tabs[0].url.includes('messenger.com') || tabs[0].url.includes('facebook.com'))) {
      chrome.tabs.reload(tabs[0].id);
    }
  });
}

// Check immediately
checkBotStatus();

// Refresh status when popup is shown
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(checkBotStatus, 1000);
  
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
    display: block;
  `;
  refreshBtn.addEventListener('click', refreshMessenger);
  document.body.appendChild(refreshBtn);
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "DEBUG_LOG") {
    const debugContent = document.getElementById('debug-content');
    if (debugContent && !debugContent.querySelector('.status-connected')) {
      debugContent.innerHTML = '<span class="status-connected">Bot connected! Monitoring messages...</span>';
    }
    
    // Append log to debug content
    const logElement = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    logElement.textContent = `[${time}] ${request.message}`;
    debugContent.appendChild(logElement);
    debugContent.scrollTop = debugContent.scrollHeight;
  }
});