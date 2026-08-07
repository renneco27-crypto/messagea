let processedMessages = new Set();
let lastSentMessage = '';
let isTyping = false;
let botStartTime = Date.now();

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

// Watch for DOM changes
const observer = new MutationObserver(() => {
  checkForNewMessages();
});

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

setTimeout(() => {
  logDebug('Bot ready - scanning for messages every 1s');
}, 2000);

function checkForNewMessages() {
  if (isTyping) return;
  
  try {
    // Debug: Log what we're finding
    const allSpans = document.querySelectorAll('span[data-lexical-text="true"]');
    const allMessageDivs = document.querySelectorAll('div[data-testid="message-content"]');
    const allMessageRows = document.querySelectorAll('[data-testid*="message"], [data-testid*="Message"]');
    logDebug('DOM scan: spans=' + allSpans.length + ' divs=' + allMessageDivs.length + ' msgRows=' + allMessageRows.length);
    
    // Use the same selectors that worked
    const candidates = document.querySelectorAll('div[data-testid="message-content"], span[data-lexical-text="true"]');
    
    if (candidates.length === 0) {
      logDebug('No message elements found - trying fallback selectors');
      
      // Fallback: Try to find message containers with different selectors
      const fallbackSelectors = [
        '[data-testid="message-content"]',
        '[data-testid="message-row"]',
        '[data-testid*="Message"]',
        'span[data-lexical-text]',
        'div[dir="auto"]'
      ];
      
      for (const selector of fallbackSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          logDebug('Fallback found with "' + selector + '": ' + elements.length);
        }
      }
      return;
    }
    
    // Continue with normal processing...
    let newMessages = [];
    
    candidates.forEach(el => {
      const text = el.textContent.trim();
      if (text.length === 0 || text.length > 200) return;
      
      // Skip our own messages to prevent feedback loop
      if (text === lastSentMessage || (lastSentMessage && text.includes(lastSentMessage.substring(0, 20)))) {
        return;
      }
      
      // Additional check: look for outgoing message indicators
      const isInOutgoingBubble = el.closest('[data-testid="message-content"]')?.parentElement?.className?.includes('outgoing') ||
                                el.closest('[data-testid="MessageGroupOutgoing"]') ||
                                el.closest('.message-out');
      
      if (isInOutgoingBubble) {
        return; // Skip our own outgoing messages
      }
      
      // Clean up message text - remove timestamp patterns
      let messageContent = text
        .replace(/^(At\s+)?\d{1,2}:\d{2}\s*(AM|PM)\s*(,\s*)?/i, '')
        .replace(/\s*(PM|AM)\s*(by\s+)?\w+:\s*/i, '')
        .trim();
      
      // Skip empty, UI elements, and system messages
      const lowerText = messageContent.toLowerCase();
      
      const skipPhrases = [
        'press enter', 'send', 'emoji', 'sticker', 'attach photo', 'attach file',
        'aa', 'reply to', 'message sent', 'what do you mean',
        'settings', 'info', 'call', 'video', 'gif', 'photo', 'like',
        'enter', 'message', 'type a message', 'click to open',
        'notifications', 'privacy', 'groups', 'friends', 'memories',
        'watch', 'marketplace', 'gaming', 'pages', 'logout'
      ];
      
      if (skipPhrases.some(phrase => lowerText.includes(phrase))) return;
      
      if (messageContent.length < 3) return;
      
      newMessages.push({text: messageContent, originalText: text, id: messageContent + text});
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
    // Silent fail
  }
}

function handleTrigger(messageText) {
  const lowerText = messageText.toLowerCase().trim();
  
  logDebug('Checking trigger for: "' + lowerText + '"');
  
  // Keep the simple, working trigger logic
  if (lowerText.includes('happy birthday')) {
    logDebug('Trigger matched - replying');
    const reply = '🎉 Happy Birthday! Have a great day!';
    lastSentMessage = reply;
    sendAutoReply(reply);
    return;
  }
  
  logDebug('No trigger match for: ' + lowerText);
}

function findInputBox() {
  return (
    document.querySelector('div[data-lexical-editor="true"][contenteditable="true"][aria-label*="Write"]') ||
    document.querySelector('div[contenteditable="true"][role="textbox"][aria-label*="Write"]') ||
    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
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
  }, 100 + Math.random() * 1900);
}

function sendAutoReply(responseText) {
  logDebug('Starting reply...');
  simulateTyping(responseText, () => {
    let sent = false;
    
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      logDebug('Reply sent via button!');
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
        logDebug('Reply sent via Enter key');
        sent = true;
      }
    }
    
    if (!sent) {
      logDebug('Failed to send reply!');
    }
  });
}