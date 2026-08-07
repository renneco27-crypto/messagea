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

logDebug('🤖 Bot script loaded on Messenger');

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
  logDebug('Bot ready - monitoring for new incoming messages only');
}, 2000);

function checkForNewMessages() {
  // Prevent multiple checks if already typing
  if (isTyping) return;
  
  try {
    // Look for message groups in Messenger chat
    // Messenger structure: messages are in divs with specific attributes
    // Look for actual message content from other users only
    
    const messageElements = document.querySelectorAll('div[role="article"][aria-roledescription="message"]');
    
    if (messageElements.length === 0) {
      // Fallback: Look for any div that might contain message text
      const altMessages = document.querySelectorAll('div[dir="auto"].html-div, div[contenteditable="false"]');
      processMessageElements(altMessages);
      return;
    }
    
    processMessageElements(messageElements);
    
  } catch (error) {
    logDebug('Scan error: ' + error.message.substring(0, 100));
  }
}

function processMessageElements(elements) {
  elements.forEach(el => {
    // Extract message text
    const textContent = el.textContent.trim();
    
    // Skip empty
    if (!textContent || textContent.length < 3) return;
    
    // Skip if contains timestamp patterns (means it's a status/UI element)
    if (textContent.match(/\d+:\d+\s*(AM|PM|am|pm)/) || 
        textContent.includes('Message sent') ||
        textContent.includes('What do you mean') ||
        textContent.includes('sent,') ||
        textContent.includes('Message actions')) return;
    
    // Skip UI elements
    const skipPhrases = [
      'press enter', 'send', 'emoji', 'sticker', 'attach', 'reply',
      'typing', 'online', 'active', 'settings', 'info', 'call', 
      'video', 'gif', 'photo', 'like', 'Aa', 'write to', 'compose',
      'open more actions', 'choose', 'message actions'
    ];
    
    const lowerText = textContent.toLowerCase();
    if (skipPhrases.some(phrase => lowerText.includes(phrase))) return;
    
    // Skip our own messages - look for indicators
    // If aria-label contains our name or "you", skip
    const ariaLabel = el.getAttribute('aria-label') || '';
    if (ariaLabel.includes('You:') || ariaLabel.includes('you said')) return;
    
    // Create unique ID from text content + some position info
    const messageId = textContent + el.offsetTop;
    
    // Check if we've already processed this message
    if (!processedMessages.has(messageId)) {
      processedMessages.add(messageId);
      
      // Clean the text for trigger matching
      let cleanText = textContent;
      // Remove timestamp prefixes like "At 6:49 PM, Lawrence:" 
      cleanText = cleanText.replace(/^(At\s+)?\d{1,2}:\d{2}\s*(AM|PM)\s*(,\s*)?[^:]*:\s*/i, '');
      cleanText = cleanText.trim();
      
      // Skip if cleaning left us with nothing meaningful
      if (cleanText.length < 3) return;
      
      logDebug('✅ New message detected: "' + cleanText + '" (raw: "' + textContent.substring(0, 50) + '")');
      handleTrigger(cleanText);
    }
  });
  
  // Cleanup old entries
  if (processedMessages.size > 50) {
    processedMessages.clear();
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
  
  logDebug('🔍 Checking triggers for: "' + lowerText + '"');
  
  // Check for happy birthday phrases
  const birthdayPatterns = [
    'happy birthday',
    'happy bday',
    'hiphop birthday',
    'happiest birthday'
  ];
  
  for (const pattern of birthdayPatterns) {
    if (lowerText.includes(pattern)) {
      logDebug('🎂 Birthday trigger matched - replying');
      lastSentMessage = '🎉 Happy Birthday! Have a great day!';
      sendAutoReply('🎉 Happy Birthday! Have a great day!');
      return;
    }
  }
  
  logDebug('❌ No trigger match found for: ' + lowerText);
}

function findInputBox() {
  return (
    // The exact div you provided
    document.querySelector('div[aria-label*="Write"][contenteditable="true"][role="textbox"][data-lexical-editor="true"]') ||
    // Fallback selectors
    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
    document.querySelector('div[data-lexical-editor="true"][contenteditable="true"]')
  );
}

function findSendButton() {
  return (
    document.querySelector('div[data-testid="send-button"]') ||
    document.querySelector('button[aria-label="Send"]') ||
    document.querySelector('i[data-testid="send-message-icon"]')
  );
}

function simulateTyping(text, callback) {
  isTyping = true;
  
  const inputBox = findInputBox();
  if (!inputBox) {
    logDebug('❌ Input box not found!');
    isTyping = false;
    return;
  }

  logDebug('⌨️ Found input box - starting to type...');
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
      logDebug('✅ Typing complete');
      isTyping = false;
      if (callback) callback();
    }
  }, 100 + Math.random() * 1900); // Random delay between 0.1s and 2.0s
}

function sendAutoReply(responseText) {
  logDebug('📤 Sending reply: ' + responseText.substring(0, 50));
  simulateTyping(responseText, () => {
    let sent = false;
    
    // Try send button first
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      logDebug('✅ Reply sent via button!');
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
        logDebug('✅ Reply sent via Enter key');
        sent = true;
      }
    }
    
    if (!sent) {
      logDebug('❌ Failed to send reply!');
    }
  });
}