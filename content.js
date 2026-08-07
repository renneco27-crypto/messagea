let processedMessages = new Set();
let lastSentMessage = '';
let pingTimeoutId = null;

logDebug('Bot script loaded on Messenger');

// Watch for DOM changes
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

// Also scan periodically
const scanInterval = setInterval(() => {
  checkForNewMessages();
}, 1000);

// Respond to ping from popup with immediate reply
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "PING") {
    sendResponse({botReady: true, timestamp: Date.now()});
    // Don't return true - immediate sync response
  }
  return false;
});

setTimeout(() => {
  logDebug('Bot ready - active on current tab');
}, 1000);

function checkForNewMessages() {
  try {
    // Find message content spans - these contain actual text
    const messageSpans = document.querySelectorAll('span[data-lexical-text="true"]');
    
    if (messageSpans.length === 0) return;
    
    // Check multiple recent messages
    const recentSpans = Array.from(messageSpans).slice(-5);
    
    recentSpans.forEach(span => {
      const messageText = span.textContent.trim();
      
      if (!messageText || messageText.length < 3) return;
      
      // Filter out system/UI text
      const skipPhrases = [
        'press enter', 'send', 'emoji', 'sticker', 'attach photo', 'attach file',
        'aa', 'reply to', 'message sent', 'what do you mean',
        'type a message', 'click to open', 'notifications', 'type to search',
        'online', 'active now', 'active today', 'typing'
      ];
      
      const lowerText = messageText.toLowerCase();
      if (skipPhrases.some(phrase => lowerText.includes(phrase))) return;
      
      // Skip if this is our own message
      if (messageText === lastSentMessage) return;
      
      // Unique key for deduplication
      const messageKey = messageText + span.offsetTop + span.offsetLeft;
      
      if (!processedMessages.has(messageKey)) {
        processedMessages.add(messageKey);
        logDebug('Message: "' + messageText + '"');
        handleTrigger(messageText);
        
        if (processedMessages.size > 100) {
          processedMessages.clear();
        }
      }
    });
    
  } catch (error) {
    // Silent fail
  }
}

function handleTrigger(messageText) {
  const lowerText = messageText.toLowerCase().trim();
  
  // Trigger on partial or full match (>=2 words matched)
  const triggers = [
    { pattern: 'happy birthday', response: '🎉 Happy Birthday! Have a great day!' },
    { pattern: 'hello', response: '👋 Hey there!' },
    { pattern: 'hi', response: '👋 Hello!' },
    { pattern: 'class today', response: 'Checking... Please wait.' }
  ];
  
  for (const trigger of triggers) {
    if (lowerText.includes(trigger.pattern)) {
      logDebug('Trigger matched: ' + trigger.pattern);
      lastSentMessage = trigger.response;
      sendAutoReply(trigger.response);
      return;
    }
  }
  
  logDebug('No match: ' + lowerText);
}

function findInputBox() {
  return (
    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
    document.querySelector('div[data-lexical-editor="true"]')
  );
}

function findSendButton() {
  return (
    document.querySelector('div[data-testid="send-button"]') ||
    document.querySelector('button[aria-label="Send"]')
  );
}

function simulateTyping(text, callback) {
  const inputBox = findInputBox();
  if (!inputBox) {
    logDebug('Input box not found!');
    return;
  }

  logDebug('Found input - typing...');
  inputBox.focus();

  // Clear existing content
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  let i = 0;
  const interval = setInterval(() => {
    if (i < text.length) {
      document.execCommand('insertText', false, text[i]);
      i++;
    } else {
      clearInterval(interval);
      logDebug('Typing done');
      if (callback) callback();
    }
  }, 150 + Math.random() * 300);
}

function sendAutoReply(responseText) {
  logDebug('Sending: ' + responseText.substring(0, 50));
  
  simulateTyping(responseText, () => {
    let sent = false;
    
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      logDebug('Sent!');
      sent = true;
    }
    
    if (!sent) {
      const inputBox = findInputBox();
      if (inputBox) {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true
        });
        inputBox.dispatchEvent(enterEvent);
        logDebug('Sent via Enter');
        sent = true;
      }
    }
    
    if (!sent) {
      logDebug('All send methods failed!');
    }
  });
}

function logDebug(msg) {
  console.log('[School GC Bot] ' + msg);
  try {
    chrome.runtime.sendMessage({type: 'DEBUG_LOG', message: msg});
  } catch (e) {
    // Silent fail
  }
}