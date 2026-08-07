let processedMessages = new Set();
let ourOwnMessages = new Set(); // Track messages we've sent
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
  logDebug('Bot ready - monitoring for new messages');
}, 2000);

function checkForNewMessages() {
  // Prevent multiple checks if already typing
  if (isTyping) return;
  
  try {
    // Find actual chat messages from other users
    // Look for message elements that contain user text
    const messageElements = document.querySelectorAll('div[role="article"][aria-roledescription="message"]');
    
    if (messageElements.length === 0) {
      // Fallback: Look for message content spans that contain actual text
      const messageSpans = document.querySelectorAll('span[data-lexical-text="true"]');
      processMessageElements(messageSpans);
      return;
    }
    
    processMessageElements(messageElements);
    
  } catch (error) {
    logDebug('Scan error: ' + error.message.substring(0, 100));
  }
}

function processMessageElements(elements) {
  // Only process the latest few messages to avoid scanning everything
  const recentElements = Array.from(elements).slice(-10);
  
  recentElements.forEach(el => {
    let textContent = el.textContent.trim();
    if (!textContent || textContent.length < 3) return;
    
    // Skip UI elements, system messages, and timestamps
    const skipPhrases = [
      'press enter', 'send', 'emoji', 'sticker', 'attach photo', 'attach file',
      'aa', 'reply to', 'message sent', 'what do you mean',
      'type a message', 'click to open', 'notifications', 'type to search',
      'online', 'active now', 'active today', 'typing',
      'settings', 'info', 'call', 'video', 'gif', 'photo', 'like',
      'write to', 'compose', 'open more actions', 'choose',
      'message actions', 'sent,', 'pm', 'messages_table'
    ];
    
    const lowerText = textContent.toLowerCase();
    if (skipPhrases.some(phrase => lowerText.includes(phrase))) return;
    
    // Skip timestamps
    if (textContent.match(/^\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/)) return;
    
    // Check if this is our own message (skip it)
    // Our own messages contain our reply text
    const ourReply = '🎉 Happy Birthday! Have a great day!';
    if (textContent.includes(ourReply) || 
        (lastSentMessage && textContent.toLowerCase().includes(lastSentMessage.toLowerCase()))) {
      return;
    }
    
    // Skip gibberish (too many repeated or non-standard characters)
    // Check if text has unusual character patterns that suggest typing artifacts
    if (isGibberish(textContent)) return;
    
    // Clean the text for trigger matching
    let cleanText = textContent;
    // Remove timestamp prefixes like "At 6:49 PM, Lawrence: "
    cleanText = cleanText.replace(/^(At\s+)?\d{1,2}:\d{2}\s*(AM|PM)?\s*(,\s*)?[^:]*:\s*/i, '');
    cleanText = cleanText.trim();
    
    // Skip if cleaning left us with nothing meaningful
    if (cleanText.length < 3) return;
    
    // Create unique ID from text content + element position
    const messageId = cleanText + el.offsetTop + el.offsetLeft;
    
    // Only process if we haven't seen this message before
    if (!processedMessages.has(messageId)) {
      processedMessages.add(messageId);
      logDebug('✅ Incoming message: "' + cleanText + '"');
      handleTrigger(cleanText);
    }
  });
  
  // Cleanup old entries periodically
  if (processedMessages.size > 50) {
    processedMessages.clear();
  }
}

function isGibberish(text) {
  // Detect common gibberish patterns from typing animation
  // Too many repeated letters: "hhapppy", "bbbirrrthday"
  // Random spacing: "Ha ppy Birthday"
  // Character swapping: "Biarthyday"
  
  // Count repeated character sequences
  const repeatedChars = text.match(/([a-zA-Z])\1{3,}/);
  if (repeatedChars) return true;
  
  // Count unusual spacing
  const words = text.split(' ');
  if (words.length > 2) {
    const avgWordLength = text.replace(/\s/g, '').length / words.length;
    // Gibberish often has very short avg word length due to weird spacing
    if (avgWordLength < 1.5) return true;
  }
  
  return false;
}

function logDebug(msg) {
  console.log('[School GC Bot] ' + msg);
  try {
    chrome.runtime.sendMessage({type: 'DEBUG_LOG', message: msg});
  } catch (e) {
    // Silently fail when extension context is invalidated
  }
}

let lastSentMessage = '';

function handleTrigger(messageText) {
  const lowerText = messageText.toLowerCase().trim();
  
  logDebug('🔍 Checking triggers for: "' + lowerText + '"');
  
  // Check for birthday phrases
  const birthdayKeywords = ['happy birthday', 'happy bday', 'happiest birthday'];
  
  for (const keyword of birthdayKeywords) {
    if (lowerText.includes(keyword)) {
      logDebug('🎂 Birthday trigger matched - replying');
      lastSentMessage = '🎉 Happy Birthday! Have a great day!';
      ourOwnMessages.add(lastSentMessage);
      sendAutoReply('🎉 Happy Birthday! Have a great day!');
      return;
    }
  }
  
  logDebug('❌ No trigger match found');
}

function findInputBox() {
  return (
    document.querySelector('div[aria-label*="Write"][contenteditable="true"][role="textbox"][data-lexical-editor="true"]') ||
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

  logDebug('⌨️ Found input box - typing...');
  inputBox.focus();

  // Clear any existing content
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  let i = 0;
  const interval = setInterval(() => {
    if (i < text.length) {
      document.execCommand('insertText', false, text[i]);
      i++;
    } else {
      clearInterval(interval);
      logDebug('✅ Typing complete');
      isTyping = false;
      if (callback) callback();
    }
  }, 150 + Math.random() * 300); // More natural typing speed
}

function sendAutoReply(responseText) {
  logDebug('📤 Sending: ' + responseText.substring(0, 50));
  
  simulateTyping(responseText, () => {
    let sent = false;
    
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      logDebug('✅ Sent via button!');
      sent = true;
    }
    
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
        logDebug('✅ Sent via Enter');
        sent = true;
      }
    }
    
    if (!sent) {
      logDebug('❌ Failed to send!');
    }
    
    // Wait before allowing next reply to prevent loops
    setTimeout(() => {
      isTyping = false;
    }, 2000);
  });
}