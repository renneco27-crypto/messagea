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
  logDebug('Bot ready - scanning every 1s for new messages');
}, 2000);

function checkForNewMessages() {
  // Prevent multiple checks if already typing
  if (isTyping) return;
  
  try {
    // Target actual chat message bubbles in Messenger
    // These are divs with specific role and aria-label patterns for user messages
    const messageSelectors = [
      'div[role="button"][aria-label*="message"][tabindex="0"]',
      'div[aria-label*="What do you mean"]',
      'div[data-message-id]:not([aria-label*="emoji"]):not([aria-label*="sticker"]):not([aria-label*="send"])'
    ];
    
    let messageBubbles = document.querySelectorAll(messageSelectors.join(', '));
    
    if (messageBubbles.length === 0) {
      logDebug('No messages found with primary selector, trying fallback');
      
      // Fallback: find chat bubble elements
      const chatBubbles = document.querySelectorAll('[data-testid="message-content"], [data-testid="message-row"]');
      if (chatBubbles.length > 0) {
        const latest = chatBubbles[chatBubbles.length - 1];
        const messageText = latest.textContent.trim();
        if (messageText.length > 0 && messageText.length < 200) {
          const msgId = messageText;
          if (!processedMessages.has(msgId)) {
            processedMessages.add(msgId);
            logDebug('Message found: ' + messageText);
            handleTrigger(messageText);
          }
        }
      }
      return;
    }
    
    // Process each message bubble
    messageBubbles.forEach(bubble => {
      const messageText = bubble.getAttribute('aria-label') || bubble.textContent;
      
      // Skip empty messages and UI controls
      if (!messageText || messageText.trim().length < 3 || messageText.trim().length > 150) return;
      
      // Skip if it contains common UI phrases
      const skipPhrases = ['press enter', 'send', 'emoji', 'sticker', 'attach photo', 'attach file', 'Aa'];
      if (skipPhrases.some(phrase => messageText.toLowerCase().includes(phrase))) return;
      
      const msgId = messageText;
      
      if (!processedMessages.has(msgId)) {
        processedMessages.add(msgId);
        logDebug('Message detected: ' + messageText);
        handleTrigger(messageText);
      }
    });
    
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
  
  logDebug('Checking: "' + lowerText + '"');
  
  // Respond to birthday messages
  if (lowerText === 'happy birthday' || 
      lowerText === 'happy birthday!!' ||
      lowerText === 'happy birthday!') {
    logDebug('Trigger matched - replying');
    sendAutoReply('🎉 Happy Birthday! Have a great day!');
    return;
  }
  
  logDebug('No exact match for: ' + lowerText);
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
  logDebug('Replying: ' + responseText);
  simulateTyping(responseText, () => {
    let sent = false;
    
    // Try send button first
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      logDebug('Sent!');
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
        logDebug('Sent via Enter');
        sent = true;
      }
    }
    
    if (!sent) {
      logDebug('Failed to send!');
    }
  });
}