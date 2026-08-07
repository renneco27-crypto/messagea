let processedMessages = new Set();
let lastSentMessage = '';
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

logDebug('🤖 Bot loaded on Messenger');

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
setInterval(() => {
  checkForNewMessages();
}, 1000);

function checkForNewMessages() {
  if (isTyping) return;
  
  try {
    // Target specific Messenger message elements
    // These are the actual message bubbles from other users
    const messageElements = document.querySelectorAll('div[role="article"][aria-roledescription="message"]');
    
    if (messageElements.length === 0) {
      // Fallback: try to find message content
      const fallbackElements = document.querySelectorAll('div[aria-label*="message"][role="button"]');
      processElements(fallbackElements);
      return;
    }
    
    processElements(messageElements);
    
  } catch (error) {
    logDebug('Scan error: ' + error.message.substring(0, 100));
  }
}

function processElements(elements) {
  const recentElements = Array.from(elements).slice(-10);
  
  recentElements.forEach(el => {
    // Extract text content
    const textContent = el.textContent.trim();
    if (!textContent || textContent.length < 3) return;
    
    // Get aria-label for additional context
    const ariaLabel = el.getAttribute('aria-label') || '';
    
    // Skip UI/system elements
    const skipTexts = [
      'press enter', 'send', 'emoji', 'sticker', 'attach', 'reply',
      'message sent', 'what do you mean', 'message actions',
      'type a message', 'click to open', 'notifications',
      'type to search', 'online', 'active', 'typing',
      'settings', 'info', 'call', 'video', 'gif', 'photo', 'like',
      'write to', 'compose', 'open more', 'choose',
      'messages_table', 'sent,'
    ];
    
    const combinedText = (textContent + ' ' + ariaLabel).toLowerCase();
    if (skipTexts.some(text => combinedText.includes(text))) return;
    
    // Skip timestamps
    if (textContent.match(/^\d{1,2}:\d{2}\s*(AM|PM|am|pm)/)) return;
    
    // Skip our own messages
    if (lastSentMessage && textContent.includes(lastSentMessage)) return;
    
    // Skip message previews from our own replies
    const ourReplyPreview = '🔍 Checking triggers for:';
    if (textContent.includes(ourReplyPreview)) return;
    
    // Create unique ID
    const messageId = textContent + el.offsetTop + el.offsetLeft;
    
    if (!processedMessages.has(messageId)) {
      processedMessages.add(messageId);
      
      // Clean timestamp prefix
      let cleanText = textContent
        .replace(/^(At\s+)?\d{1,2}:\d{2}\s*(AM|PM)?\s*(,\s*)?[^:]*:\s*/i, '')
        .trim();
      
      if (cleanText.length >= 3) {
        logDebug('📩 New message: "' + cleanText + '"');
        handleTrigger(cleanText);
      }
    }
  });
  
  if (processedMessages.size > 100) {
    processedMessages.clear();
  }
}

function handleTrigger(messageText) {
  const lowerText = messageText.toLowerCase().trim();
  logDebug('🔍 Checking triggers for: "' + lowerText + '"');
  
  // Birthday trigger
  if (lowerText.includes('happy birthday')) {
    logDebug('🎂 Trigger matched - replying');
    lastSentMessage = '🎉 Happy Birthday! Have a great day!';
    sendAutoReply(lastSentMessage);
    return;
  }
  
  logDebug('❌ No match for: ' + lowerText);
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

  logDebug('⌨️ Typing response...');
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
      logDebug('✅ Done typing');
      isTyping = false;
      if (callback) callback();
    }
  }, 150 + Math.random() * 300);
}

function sendAutoReply(responseText) {
  logDebug('📤 Sending reply...');
  simulateTyping(responseText, () => {
    let sent = false;
    
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      logDebug('✅ Sent!');
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
        logDebug('✅ Sent via Enter');
        sent = true;
      }
    }
    
    if (!sent) logDebug('❌ Failed to send!');
    
    // Cooldown
    setTimeout(() => {
      isTyping = false;
    }, 1500);
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