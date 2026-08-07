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

logDebug('🤖 Bot script loaded on Messenger');

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

setTimeout(() => {
  logDebug('Bot ready - monitoring all message types');
}, 2000);

function checkForNewMessages() {
  if (isTyping) return;
  
  try {
    // Look for incoming message bubbles - these have aria-roledescription="message"
    // and are inside role="article" containers
    const messageContainers = document.querySelectorAll('div[role="article"][aria-label*="message"]');
    
    if (messageContainers.length > 0) {
      logDebug('🔍 Found ' + messageContainers.length + ' message containers');
      
      // Process each message container
      messageContainers.forEach(container => {
        const ariaLabel = container.getAttribute('aria-label') || '';
        const messageId = container.getAttribute('data-message-id') || ariaLabel + container.offsetTop;
        
        // Skip if we've already processed this message
        if (processedMessages.has(messageId)) return;
        processedMessages.add(messageId);
        
        // Extract the message text from aria-label
        // Format: "At 7:04 PM, Lawrence: Happy birthday"
        let messageText = ariaLabel;
        
        // Remove timestamp and sender prefix to get just the message
        messageText = messageText
          .replace(/^(At\s+)?\d{1,2}:\d{2}\s*(AM|PM|am|pm)?\s*(,\s*)?[^:]*:\s*/i, '')
          .trim();
        
        logDebug('📨 Message: "' + messageText + '" (from: "' + ariaLabel.substring(0, 30) + '")');
        
        // Skip empty messages
        if (messageText.length < 2) return;
        
        // Skip system/UI messages
        const skipTexts = ['message sent', 'what do you mean', 'message actions', 'loading'];
        if (skipTexts.some(text => messageText.toLowerCase().includes(text))) return;
        
        handleTrigger(messageText);
      });
      
      return;
    }
    
    // Fallback: look for spans with lexical text (typing animation areas)
    const lexicalSpans = document.querySelectorAll('span[data-lexical-text="true"]');
    if (lexicalSpans.length > 0) {
      logDebug('🔍 Fallback: Found ' + lexicalSpans.length + ' lexical spans');
      
      const latestSpan = lexicalSpans[lexicalSpans.length - 1];
      const text = latestSpan.textContent.trim();
      
      if (text.length >= 2 && text.length < 200) {
        const messageId = 'lexical_' + text + latestSpan.offsetTop;
        if (!processedMessages.has(messageId)) {
          processedMessages.add(messageId);
          
          // Skip UI phrases
          const skipPhrases = ['send', 'emoji', 'sticker', 'attach', 'press enter', 'aa'];
          const lowerText = text.toLowerCase();
          if (!skipPhrases.some(phrase => lowerText.includes(phrase))) {
            logDebug('📝 Lexical span: "' + text + '"');
            handleTrigger(text);
          }
        }
      }
    }
    
    // Cleanup old entries
    if (processedMessages.size > 100) {
      processedMessages.clear();
    }
    
  } catch (error) {
    logDebug('⚠️ Scan error: ' + error.message.substring(0, 100));
  }
}

function handleTrigger(messageText) {
  const lowerText = messageText.toLowerCase().trim();
  
  logDebug('🔍 Checking triggers for: "' + lowerText + '"');
  
  // Birthday trigger - respond to any message containing "birthday"
  if (lowerText.includes('birthday')) {
    logDebug('🎂 Birthday trigger matched!');
    lastSentMessage = '🎉 Happy Birthday! Have a great day!';
    sendAutoReply(lastSentMessage);
    return;
  }
  
  logDebug('❌ No trigger match found');
}

function findInputBox() {
  // Target the exact input div from your provided HTML
  const inputSelectors = [
    'div[aria-label*="Write"][contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
    'div[contenteditable="true"][role="textbox"][aria-label*="Write"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[data-lexical-editor="true"][contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder="Aa"]',
    'textarea[aria-label*="Write"], input[aria-label*="Write"]'
  ];
  
  for (const selector of inputSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      return el;
    }
  }
  
  return null;
}

function findSendButton() {
  // Based on your HTML, the send button is likely identified by these attributes
  const selectors = [
    'div[data-testid="send-button"]',
    'button[aria-label="Send"]',
    'button[type="submit"]',
    'div[aria-label="Send"][role="button"]',
    'svg[data-testid="send-message-icon"]'
  ];
  
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      // For SVGs, find parent button
      if (el.tagName === 'svg') {
        return el.closest('button') || el.parentElement;
      }
      return el;
    }
  }
  
  return null;
}

function simulateTyping(text, callback) {
  isTyping = true;
  
  const inputBox = findInputBox();
  if (!inputBox) {
    logDebug('❌ Input box not found!');
    isTyping = false;
    return;
  }

  logDebug('⌨️ Found input box - focusing and typing...');
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
      logDebug('✅ Typing complete');
      isTyping = false;
      if (callback) callback();
    }
  }, 150 + Math.random() * 400); // Variable typing speed
}

function sendAutoReply(responseText) {
  logDebug('📤 Preparing to reply: ' + responseText.substring(0, 50));
  
  simulateTyping(responseText, () => {
    let sent = false;
    
    // Try send button first
    const sendButton = findSendButton();
    if (sendButton) {
      try {
        sendButton.click();
        logDebug('✅ Reply sent successfully!');
        sent = true;
      } catch (e) {
        logDebug('⚠️ Send button click failed, trying Enter');
      }
    }
    
    // Fallback: Try Enter key
    if (!sent) {
      const inputBox = findInputBox();
      if (inputBox) {
        try {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true
          });
          inputBox.dispatchEvent(enterEvent);
          logDebug('✅ Reply sent via Enter key');
          sent = true;
        } catch (e) {
          logDebug('❌ Failed to send via Enter');
        }
      }
    }
    
    if (!sent) {
      logDebug('❌ All send methods failed!');
    }
    
    // Cooldown period
    setTimeout(() => {
      isTyping = false;
    }, 2000);
  });
}

function logDebug(msg) {
  console.log('[School GC Bot] ' + msg);
  try {
    chrome.runtime.sendMessage({type: 'DEBUG_LOG', message: msg});
  } catch (e) {
    // Silent fail when extension context is invalidated
  }
}