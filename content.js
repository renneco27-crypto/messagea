let processedMessages = new Set();
let lastSentMessage = '';
let botStartTime = Date.now();
let isTyping = false;

// Only respond to messages sent within this window (avoids replying to history)
const FRESHNESS_WINDOW_MS = 3 * 60 * 1000; // 3 minutes
// During the first seconds after load the whole chat history renders; baseline it
// without responding so past messages never trigger a reply.
const STARTUP_GRACE_MS = 5000;
// Tolerate a small future skew (clock drift) so a just-sent message still counts as fresh.
const FUTURE_TOLERANCE_MS = 30 * 1000;

/**
 * Parse "At 6:32\u202fPM, ..." -> a Date for today at that clock time.
 * Labels carry no date, so we assume today. Returns null if not parseable.
 */
function parseMessageTime(ariaLabel) {
  const m = ariaLabel.match(/^At\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12;
  if (ap === 'AM' && hour === 12) hour = 0;

  const now = new Date();
  const parsed = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);

  // If parsed time lands >12h in the future, the message was actually yesterday
  // (e.g. sent 11:58 PM, now 12:01 AM).
  if (parsed.getTime() - now.getTime() > 12 * 60 * 60 * 1000) {
    parsed.setDate(parsed.getDate() - 1);
  }
  return parsed;
}

/** True only if the message timestamp is "just now" (within FRESHNESS_WINDOW_MS). */
function isFreshMessage(ariaLabel) {
  const t = parseMessageTime(ariaLabel);
  if (!t) return false; // can't parse timestamp -> do NOT respond (conservative)
  const diff = Date.now() - t.getTime();
  return diff >= -FUTURE_TOLERANCE_MS && diff <= FRESHNESS_WINDOW_MS;
}

// Track processed message IDs from Messenger
let processedMessageIds = new Set();

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
  logDebug('Bot ready - monitoring for messages');
}, 2000);

function checkForNewMessages() {
  if (isTyping) return;
  
  try {
    // Real Messenger message bubbles: aria-roledescription="message" + data-message-id.
    // NOTE: do NOT also match role="button" "Message sent" rows (those are our own sends -> loop).
    const messageDivs = document.querySelectorAll('div[aria-roledescription="message"][data-message-id]');

    if (messageDivs.length > 0) {
      messageDivs.forEach(div => {
        const ariaLabel = div.getAttribute('aria-label') || '';
        const messageId = div.getAttribute('data-message-id') || ariaLabel + div.offsetTop;

        // Skip if already processed
        if (processedMessages.has(messageId)) return;
        processedMessages.add(messageId);

        // Skip our own outgoing messages ("..., You: ...")
        if (isOwnMessage(ariaLabel)) {
          logDebug('⏭️ Own message skipped');
          return;
        }

        // Only respond to messages sent just now, never chat history.
        if (!isFreshMessage(ariaLabel)) {
          logDebug('⏭️ Old message (history) skipped');
          return;
        }

        // Extract message text from aria-label
        // Format: "At 7:04 PM, Lawrence: Happy birthday"  (note: \u202f before PM)
        let messageText = extractMessageText(ariaLabel);

        logDebug('📨 Raw: "' + ariaLabel + '"');
        logDebug('📝 Extracted: "' + messageText + '"');

        // Skip if nothing extracted
        if (!messageText || messageText.length < 2) {
          logDebug('⚠️ Empty message after extraction');
          return;
        }

        // Skip system messages
        if (isSystemMessage(messageText)) {
          logDebug('⏭️ System message filtered');
          return;
        }

        handleTrigger(messageText);
      });

      return;
    }

    // Cleanup
    if (processedMessages.size > 100) {
      processedMessages.clear();
    }

  } catch (error) {
    logDebug('⚠️ Scan error: ' + error.message.substring(0, 150));
  }
}

function extractMessageText(ariaLabel) {
  // Remove patterns like "At 7:04 PM, Lawrence: " or "7:04 PM by Lawrence: "
  let text = ariaLabel
    .replace(/^(At\s+)?\d{1,2}:\d{1,2}\s*(AM|PM|am|pm)?\s*,?\s*/i, '')
    .replace(/^(PM|AM)\s*(by\s+)?[^:]*:\s*/i, '')
    .replace(/^([^:]+):\s*/i, '') // Also handle "Name: Message" format
    .trim();
  
  // If we removed too much, try a different approach
  if (!text || text.length < 2) {
    // Get the part after the last ": "
    const parts = ariaLabel.split(': ');
    if (parts.length > 1) {
      text = parts.slice(1).join(': ').trim();
    }
  }
  
  return text || '';
}

function isOwnMessage(ariaLabel) {
  // Own messages are labelled: "At 7:04\u202fPM, You: <message>"
  const match = ariaLabel.match(/,\s*You\s*:/i);
  return !!match;
}

function isSystemMessage(text) {
  const systemPatterns = [
    'message sent',
    'what do you mean',
    'message actions',
    'loading',
    'press enter',
    'attach',
    'send a like',
    'react',
    'reply'
  ];
  
  const lowerText = text.toLowerCase();
  return systemPatterns.some(pattern => lowerText.includes(pattern));
}

function handleTrigger(messageText) {
  logDebug('🔍 Checking triggers for: "' + messageText + '"');

  // Relay: forward raw message text to webapp, type out whatever it returns
  relaySend(messageText).then(reply => {
    if (reply) {
      lastSentMessage = reply;
      sendAutoReply(reply);
    }
  }).catch(err => {
    logDebug('⚠️ Relay error: ' + (err && err.message ? err.message : err));
  });
}

const RELAY_URL = 'https://bottelegram-opw7.onrender.com/relay';

function relaySend(text) {
  return fetch(RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text })
  }).then(r => r.json()).then(data => data.reply || null);
}

function findInputBox() {
  // Try multiple selectors based on your HTML structure
  const selectors = [
    'div[aria-label*="Write"][contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
    'div[contenteditable="true"][role="textbox"][aria-label*="Write"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[data-lexical-editor="true"][contenteditable="true"]',
    'div[contenteditable][aria-label*="message"]',
    'div[contenteditable="true"][aria-placeholder="Aa"]'
  ];
  
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      logDebug('🎯 Found input via selector:', selector);
      return el;
    }
  }
  
  logDebug('❌ Could not find input box');
  return null;
}

function findSendButton() {
  // Based on your HTML, looking for the send button
  const selectors = [
    'div[data-testid="send-button"]',
    'button[aria-label="Send"]',
    'button[type="submit"]',
    'i[data-testid="send-message-icon"]',
    'div[aria-label="Send"][role="button"]'
  ];
  
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      // Handle SVGs
      if (el.tagName === 'svg' || el.tagName === 'I') {
        const parent = el.closest('button') || el.parentElement;
        if (parent) return parent;
      }
      return el;
    }
  }
  
  // Try to find any clickable element near the input
  const inputBox = findInputBox();
  if (inputBox) {
    const parent = inputBox.parentElement?.parentElement;
    if (parent) {
      const sendLike = parent.querySelector('[aria-label="Send"][role="button"], [data-testid="send-button"]');
      if (sendLike) return sendLike;
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

  logDebug('⌨️ Found input - typing...');
  inputBox.focus();

  // Clear existing content
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
  } catch (e) {
    // Try alternative clearing
    inputBox.innerHTML = '';
  }

  // Iterate by code points (Array.from), NOT text[i], so emoji like 🎉
  // (a surrogate pair) aren't split into two broken characters.
  const chars = Array.from(text);
  let i = 0;
  const interval = setInterval(() => {
    if (i < chars.length) {
      document.execCommand('insertText', false, chars[i]);
      i++;
    } else {
      clearInterval(interval);
      logDebug('✅ Typing complete');
      isTyping = false;
      if (callback) callback();
    }
  }, 200 + Math.random() * 500); // 200ms to 700ms between characters
}

function sendAutoReply(responseText) {
  logDebug('📤 Preparing to reply: ' + responseText);
  
  simulateTyping(responseText, () => {
    let sent = false;
    
    // Try send button first
    const sendButton = findSendButton();
    if (sendButton) {
      try {
        sendButton.click();
        logDebug('✅ Reply sent via button!');
        sent = true;
      } catch (e) {
        logDebug('⚠️ Button click failed: ' + e.message);
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
          logDebug('❌ Enter key failed: ' + e.message);
        }
      }
    }
    
    if (!sent) {
      logDebug('❌ All send methods failed!');
    }
    
    // Cooldown
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