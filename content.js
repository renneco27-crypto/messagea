let processedMessages = new Set();
let lastSentMessage = '';
let myUserId = null;

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

setTimeout(() => {
  logDebug('Bot ready - monitoring started');
}, 2000);

function checkForNewMessages() {
  try {
    // Find message content spans - these contain actual text
    const messageSpans = document.querySelectorAll('span[data-lexical-text="true"]');
    
    if (messageSpans.length === 0) {
      return;
    }
    
    // Get the most recent message
    const latestSpan = messageSpans[messageSpans.length - 1];
    const messageText = latestSpan.textContent.trim();
    
    if (!messageText || messageText.length < 3) return;
    
    // Filter out system/UI text
    const skipPhrases = [
      'press enter', 'send', 'emoji', 'sticker', 'attach photo', 'attach file',
      'aa', 'reply to', 'message sent', 'what do you mean',
      'type a message', 'click to open', 'notifications', 'type to search',
      'online', 'active now', 'active today'
    ];
    
    const lowerText = messageText.toLowerCase();
    if (skipPhrases.some(phrase => lowerText.includes(phrase))) return;
    
    // Skip if this looks like it's our sent message or UI
    if (messageText === lastSentMessage || 
        messageText.includes('typing') ||
        messageText === 'Aa') return;
    
    // Create unique ID based on text content and timestamp
    const messageId = messageText + Date.now();
    
    // Only process if we haven't seen this message recently
    if (!processedMessages.has(messageText)) {
      processedMessages.add(messageText);
      logDebug('Message: "' + messageText + '"');
      handleTrigger(messageText);
      
      // Clean old entries
      if (processedMessages.size > 100) {
        processedMessages.clear();
      }
    }
    
  } catch (error) {
    // Silent fail
  }
}

function handleTrigger(messageText) {
  const lowerText = messageText.toLowerCase().trim();
  
  // Trigger on partial or full match (>=2 words matched)
  const triggers = [
    { pattern: 'happy birthday', response: '🎉 Happy Birthday! Have a great day!', threshold: 0.5 },
    { pattern: 'hello', response: '👋 Hey there!', threshold: 1.0 },
    { pattern: 'hi', response: '👋 Hello!', threshold: 1.0 },
    { pattern: 'class today', response: 'Checking... Please wait.', threshold: 1.0 }
  ];
  
  for (const trigger of triggers) {
    const patternWords = trigger.pattern.split(' ');
    const messageWords = lowerText.split(' ');
    
    let matchCount = 0;
    for (const pWord of patternWords) {
      if (messageWords.some(mWord => mWord.includes(pWord))) {
        matchCount++;
      }
    }
    
    const matchRatio = matchCount / patternWords.length;
    
    if (matchRatio >= trigger.threshold) {
      logDebug('Trigger matched! (' + matchRatio + ')');
      sendAutoReply(trigger.response);
      return;
    }
  }
  
  logDebug('No trigger match for: ' + lowerText);
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
  }, 150 + Math.random() * 300); // Variable typing speed
}

function sendAutoReply(responseText) {
  logDebug('Replying: ' + responseText.substring(0, 50));
  lastSentMessage = responseText;
  
  simulateTyping(responseText, () => {
    let sent = false;
    
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      logDebug('Message sent!');
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
      logDebug('All send attempts failed!');
    }
  });
}

function logDebug(msg) {
  console.log('[School GC Bot] ' + msg);
  try {
    chrome.runtime.sendMessage({type: 'DEBUG_LOG', message: msg});
  } catch (e) {
    // Silent fail - extension context invalidated
  }
}