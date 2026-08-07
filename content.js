let processedMessages = new Set();
let botStartTime = Date.now();
let isTyping = false;

// Respond to ping from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "PING") {
    try {
      sendResponse({botReady: true});
    } catch (e) {
      // Ignore if context invalidated
    }
    return true;
  }
});

logDebug('Bot script loaded on Messenger');

// Continuous message watching - every 1 second
const scanInterval = setInterval(() => {
  checkForNewMessages();
}, 1000);

// Also use MutationObserver for immediate detection
const observer = new MutationObserver(() => {
  checkForNewMessages();
});

// Wait for DOM to be ready before observing
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

setTimeout(() => {
  logDebug('Bot ready - scanning for messages every 1s');
}, 2000);

function checkForNewMessages() {
  // Prevent multiple checks if already typing
  if (isTyping) return;
  
  try {
    // Find actual chat message bubbles - NOT UI buttons or labels
    const candidates = document.querySelectorAll('div[data-testid="message-content"], span[data-lexical-text="true"]');
    
    let newMessages = [];
    
    candidates.forEach(el => {
      let text = el.textContent.trim();
      if (text.length === 0 || text.length > 200) return;
      
      // Clean up message text - remove timestamp patterns
      // "At 6:49 PM, Lawrence: Happy birthday" -> "Happy birthday"
      // "6:54 PM by Lawrence: Hello" -> "Hello"
      let messageContent = text
        .replace(/^(At\s+)?\d{1,2}:\d{2}\s*(AM|PM)\s*(,\s*)?/i, '')
        .replace(/\s*(PM|AM)\s*(by\s+)?\w+:\s*/i, '')
        .trim();
      
      // Skip empty, UI elements, and system messages
      const lowerText = messageContent.toLowerCase();
      
      // Comprehensive list of UI/system phrases to skip
      const skipPhrases = [
        'press enter', 'send', 'emoji', 'sticker', 'attach photo', 'attach file',
        'aa', 'reply to', 'message sent', 'what do you mean',
        'settings', 'info', 'call', 'video', 'gif', 'photo', 'like',
        'enter', 'message', 'type a message', 'click to open',
        'notifications', 'privacy', 'groups', 'friends', 'memories',
        'watch', 'marketplace', 'gaming', 'pages', 'logout'
      ];
      
      // Skip if contains UI phrases
      if (skipPhrases.some(phrase => lowerText.includes(phrase))) return;
      
      // Skip if still empty or too short
      if (messageContent.length < 3) return;
      
      // Only accept messages that look like actual user text
      newMessages.push({text: messageContent, id: text});
    });
    
    // Process only the latest new messages (last 3)
    for (let i = newMessages.length - 1; i >= 0 && (newMessages.length - i) <= 3; i--) {
      const msg = newMessages[i];
      if (!processedMessages.has(msg.id)) {
        processedMessages.add(msg.id);
        logDebug('Message detected: "' + msg.text + '"');
        handleTrigger(msg.text);
      }
    }
    
    // Cleanup old entries
    if (processedMessages.size > 50) {
      processedMessages.clear();
    }
    
  } catch (error) {
    logDebug('Scan error: ' + error.message.substring(0, 100));
  }
}

function logDebug(msg) {
  console.log('[School GC Bot] ' + msg);
  try {
    chrome.runtime.sendMessage({type: 'DEBUG_LOG', message: msg});
  } catch (e) {
    // Silently fail when extension context is invalidated
  }
}

function handleTrigger(messageText) {
  const lowerText = messageText.toLowerCase().trim();
  
  logDebug('Checking trigger for: "' + lowerText + '"');
  
  // Check if message contains "happy birthday" anywhere
  if (lowerText.includes('happy birthday')) {
    logDebug('Trigger matched - replying');
    sendAutoReply('🎉 Happy Birthday! Have a great day!');
    return;
  }
  
  logDebug('No trigger match for: ' + lowerText);
}

function findInputBox() {
  // Multiple selectors for different Messenger versions
  return (
    // Lexical editor (newer Messenger)
    document.querySelector('div[data-lexical-editor="true"][contenteditable="true"][aria-label*="Write"]') ||
    // Standard contenteditable with aria-label
    document.querySelector('div[contenteditable="true"][role="textbox"][aria-label*="Write"]') ||
    // Generic contenteditable textbox
    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
    // Alternative selectors
    document.querySelector('div[data-lexical-editor="true"][contenteditable="true"]') ||
    document.querySelector('div[contenteditable="true"][aria-label*="message"]') ||
    document.querySelector('div[contenteditable="true"][aria-label*="chat"]')
  );
}

function findSendButton() {
  return (
    document.querySelector('div[data-testid="send-button"]') ||  
    document.querySelector('button[aria-label="Send"]') ||
    document.querySelector('div[aria-label="Send"]') ||
    document.querySelector('i[data-testid="send-message-icon"]') ||
    document.querySelector('div[role="button"][aria-label="Send"]')
  );
}

function simulateTyping(text, callback) {
  isTyping = true;
  
  const inputBox = findInputBox();
  if (!inputBox) {
    logDebug('Input box not found!');
    isTyping = false;
    return;
  }

  logDebug('Found input - typing...');
  inputBox.focus();

  // Clear any existing content
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  let i = 0;
  const interval = setInterval(() => {
    if (i < text.length) {
      document.execCommand('insertText', false, text[i]);
      inputBox.dispatchEvent(new InputEvent('input', { bubbles: true }));
      i++;
    } else {
      clearInterval(interval);
      logDebug('Typing done');
      isTyping = false;
      if (callback) callback();
    }
  }, 100 + Math.random() * 1900); // Random delay between 0.1s and 2.0s
}

function sendAutoReply(responseText) {
  logDebug('Starting reply...');
  simulateTyping(responseText, () => {
    let sent = false;
    
    // Try send button first
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      logDebug('Reply sent via button!');
      sent = true;
    }
    
    // Try Enter key
    if (!sent) {
      const inputBox = findInputBox();
      if (inputBox) {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true
        });
        inputBox.dispatchEvent(enterEvent);
        logDebug('Reply sent via Enter key');
        sent = true;
      }
    }
    
    if (!sent) {
      logDebug('Failed to send reply!');
    }
  });
}