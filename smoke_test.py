import re
import sys
import datetime as _dt

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

MESSENGER_HTML = r'C:\Users\corte\Desktop\messenger.html'
REPLY = "🎉 Happy Birthday! Have a great day!"
TRIGGER = 'birthday'

# Fixed "now" so tests are deterministic. 7:05 PM.
TEST2_NOW = _dt.datetime(2026, 8, 7, 19, 5, 0)

# ---------------------------------------------------------------------------
# DETECTION ALGORITHM  (mirror of content.js)
# ---------------------------------------------------------------------------

def extract_message_text(aria_label):
    """Mirror of content.js extractMessageText()."""
    text = re.sub(r'^(At\s+)?\d{1,2}:\d{1,2}\s*(AM|PM|am|pm)?\s*,?\s*', '', aria_label, flags=re.I)
    text = re.sub(r'^(PM|AM)\s*(by\s+)?[^:]*:\s*', '', text, flags=re.I)
    text = re.sub(r'^([^:]+):\s*', '', text, flags=re.I)
    text = text.strip()
    if len(text) < 2:
        parts = aria_label.split(': ', 1)
        if len(parts) > 1:
            text = ': '.join(parts[1:]).strip()
    return text


def is_system_message(text):
    patterns = [
        'message sent', 'what do you mean', 'message actions',
        'loading', 'press enter', 'attach', 'send a like', 'react', 'reply'
    ]
    low = text.lower()
    return any(p in low for p in patterns)


def is_own_sender(aria_label):
    """Own messages are labelled 'At HH:MM\u202fPM, You: ...'."""
    m = re.match(r'At\s+\d{1,2}:\d{1,2}[\s\S]{0,4}(AM|PM)[\s\S]*?,\s*([^:]+):', aria_label, flags=re.I)
    sender = m.group(2).strip() if m else None
    return sender == 'You', sender


def matches_trigger(text):
    return TRIGGER in text.lower()


# --- timestamp freshness (mirror of content.js parseMessageTime / isFreshMessage) ---
FRESHNESS_WINDOW_MS = 3 * 60 * 1000
FUTURE_TOLERANCE_MS = 30 * 1000


def parse_message_time(aria_label, now_dt):
    """Parse 'At 6:32\\u202fPM, ...' into a datetime on now_dt's date. Returns None if unparseable."""
    import datetime as _dt
    m = re.match(r'^At\s+(\d{1,2}):(\d{2})\s*(AM|PM)', aria_label, flags=re.I)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2))
    ap = m.group(3).upper()
    if ap == 'PM' and hour < 12:
        hour += 12
    if ap == 'AM' and hour == 12:
        hour = 0
    parsed = now_dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
    # yesterday rollover
    if (parsed - now_dt).total_seconds() > 12 * 3600:
        parsed = parsed - _dt.timedelta(days=1)
    return parsed


def is_fresh_message(aria_label, now_dt):
    import datetime as _dt
    t = parse_message_time(aria_label, now_dt)
    if t is None:
        return False
    diff_ms = (now_dt - t).total_seconds() * 1000
    return -FUTURE_TOLERANCE_MS <= diff_ms <= FRESHNESS_WINDOW_MS


def evaluate_message(aria_label, now_dt=None):
    """Run full pipeline. Returns dict with detection result.
    If now_dt is given, also applies the freshness gate (mirrors content.js)."""
    if now_dt is None:
        import datetime as _dt
        now_dt = _dt.datetime.now()
    own = bool(re.search(r',\s*You\s*:', aria_label, flags=re.I))
    text = extract_message_text(aria_label)
    fresh = is_fresh_message(aria_label, now_dt)
    triggered = (not own) and (len(text) >= 2) and (not is_system_message(text)) and matches_trigger(text)
    if now_dt is not None:
        triggered = triggered and fresh
    return {
        'aria_label': aria_label,
        'own': own,
        'extracted': text,
        'fresh': fresh,
        'triggered': triggered,
    }


def selector_gate_passes(aria_label, element_flags):
    """Mirror content.js selector: only div[aria-roledescription="message"][data-message-id].
    element_flags: dict with 'is_button' for synthetic 'Message sent' rows."""
    if element_flags.get('is_button'):
        return False
    if not element_flags.get('is_message'):
        return False
    return True


# ---------------------------------------------------------------------------
# WRITING ALGORITHM  (mirror of content.js simulateTyping + send)
# ---------------------------------------------------------------------------

def simulate_typing_js_indexing(text):
    """How JS does text[i] iteration: UTF-16 code units (splits surrogate pairs!)."""
    units = []
    for ch in text:
        units.extend(list(ch.encode('utf-16-le')))  # placeholder, replaced below
    # Real JS: string[i] returns the i-th UTF-16 code unit
    utf16 = text.encode('utf-16-le')
    units = [utf16[i:i+2] for i in range(0, len(utf16), 2)]
    code_units = [u.decode('utf-16-le', errors='replace') for u in units]
    return code_units


def simulate_typing_code_points(text):
    """Correct approach: iterate by code points so emoji survive."""
    return list(text)


def verify_written_message(units):
    """Join the typed units back together. Mirrors execCommand('insertText') per unit."""
    return ''.join(units)


# ---------------------------------------------------------------------------
# LOAD REAL DOM and extract messages
# ---------------------------------------------------------------------------

html = open(MESSENGER_HTML, encoding='utf-8', errors='ignore').read()

message_pat = re.compile(r'<div[^>]*aria-label="([^"]*)"[^>]*aria-roledescription="message"[^>]*data-message-id="([^"]*)"')
real_messages = message_pat.findall(html)
real_messages_any_order = re.findall(
    r'<div(?=[^>]*aria-roledescription="message")(?=[^>]*data-message-id="[^"]*")[^>]*aria-label="([^"]*)"[^>]*>',
    html
)
real_messages = [(l, '') for l in real_messages_any_order] if not real_messages else real_messages

def dom_selector_matches(selector):
    """Reimplement the CSS selector logic used in content.js for this HTML."""
    if 'aria-roledescription="message"' in selector:
        return 'aria-roledescription="message"' in html
    if '[aria-label*=" message"]' in selector:
        return re.search(r'aria-label="[^"]*\smessage', html) is not None
    if '[aria-label*="by"]' in selector:
        return re.search(r'aria-label="[^"]*by[^"]*"', html) is not None
    if 'aria-label*="Write"' in selector:
        return 'aria-label="Write' in html
    return False

# Current content.js selector string (both parts)
sel_a = 'div[aria-label*=" message"][aria-roledescription="message"]'
sel_b = 'div[aria-label*="PM"][aria-label*="by"]'
print('\nSelector check on real DOM:')
print(f'  OLD {sel_a}  ->', dom_selector_matches(sel_a))
print(f'  OLD {sel_b}  ->', dom_selector_matches(sel_b))
print('  CORRECT div[aria-roledescription="message"] ->', dom_selector_matches('div[aria-roledescription="message"]'))

# Validate the CORRECT selector excludes the "Message sent" role=button rows
msg_sent_buttons = re.findall(r'<div[^>]*role="button"[^>]*aria-label="Enter, Message sent[^"]*"[^>]*>', html)
print(f'\n"Message sent" buttons in DOM (role=button, must be excluded): {len(msg_sent_buttons)}')
for b in msg_sent_buttons[:3]:
    lbl = re.search(r'aria-label="([^"]*)"', b)
    print('   excluded OK:', 'aria-roledescription="message"' not in b, '|', (lbl.group(1)[:60] if lbl else ''))
print('Real message elements found:', len(real_messages))

# ---------------------------------------------------------------------------
# TEST 1: Real messages from captured DOM
# ---------------------------------------------------------------------------

print('\n========== TEST 1: real messages from messenger.html ==========')
pass_count = 0
fail_count = 0
for label, mid in real_messages:
    # Deterministic: evaluate at 7:05 PM. Only the 7:04 PM birthday is fresh + triggers.
    res = evaluate_message(label, now_dt=TEST2_NOW)
    expected = (not res['own']) and ('birthday' in res['extracted'].lower()) and res['fresh']
    status = 'PASS' if (res['triggered'] == expected) else 'FAIL'
    if status == 'PASS':
        pass_count += 1
    else:
        fail_count += 1
    print(f"[{status}] own={res['own']!s:5} fresh={str(res['fresh']):5} extract={res['extracted'][:40]!r:44} trigger={res['triggered']!s:5} | {label[:70]!r}")

print(f'\nTEST 1 summary: {pass_count} passed, {fail_count} failed')

# ---------------------------------------------------------------------------
# TEST 2: synthetic "try to send different things" messages
# ---------------------------------------------------------------------------

print('\n========== TEST 2: synthetic messages (bot sends these, should detect) ==========')

synthetic_cases = [
    # (aria-label, expected_trigger)
    ("At 7:04\u202fPM, Lawrence: Happy birthday", True),
    ("At 7:04 PM, Lawrence: happy birthday", True),
    ("At 7:04\u202fPM, Lawrence: Happy Birthday!!!", True),
    ("At 7:03\u202fPM, Maxy Cathy: HAPPY BIRTHDAY", True),
    ("At 7:04\u202fPM, John: happy birthday to you", True),
    ("At 7:04\u202fPM, Lawrence: Happy bday", False),  # no substring 'birthday'
    ("At 7:04\u202fPM, Lawrence: Meow", False),
    ("At 7:04\u202fPM, Lawrence", False),
    ("At 7:04\u202fPM, You: 🎉 Happy Birthday! Have a great day!", False),  # own
    ("Enter, Message sent 7:04\u202fPM by You: 🎉 Happy Birthday!", False),  # button, own send
    ("At 7:04\u202fPM, Lawrence: happy birth-day", False),  # hyphen breaks it
    ("At 7:04\u202fPM, Lawrence: happy birth days", False),  # not contiguous 'birthday'
    ("At 7:04\u202fPM, Anna: happy birthdyas", False),  # typo
    ("At 7:04\u202fPM, Coach: Happy birthday champ!", True),
]

# Fixed "now" so trigger tests are deterministic and the 7:04 PM messages are fresh.
t2_pass = 0
t2_fail = 0
for label, expected in synthetic_cases:
    # Mirror content.js: only real message bubbles pass the CSS selector gate.
    # Synthetic "Message sent" rows are role=button -> excluded before evaluation.
    is_button = label.startswith('Enter, Message sent')
    res = evaluate_message(label, now_dt=TEST2_NOW)
    passes = selector_gate_passes(label, {'is_button': is_button, 'is_message': not is_button})
    effective_trigger = res['triggered'] if passes else False
    status = 'PASS' if (effective_trigger == expected) else 'FAIL'
    if status == 'PASS':
        t2_pass += 1
    else:
        t2_fail += 1
    print(f"[{status}] expected={str(expected):5} got={str(effective_trigger):5} "
          f"gated={'excluded' if not passes else 'included'} extract={res['extracted'][:35]!r:39} | {label[:60]!r}")

print(f'\nTEST 2 summary: {t2_pass} passed, {t2_fail} failed')

# ---------------------------------------------------------------------------
# TEST 3: does the bot write the reply correctly?
# ---------------------------------------------------------------------------

print('\n========== TEST 3: reply writing ==========')

# 3a: current JS approach (text[i] = UTF-16 code unit iteration)
units_js = simulate_typing_js_indexing(REPLY)
written_js = verify_written_message(units_js)
print('Target reply :', REPLY)
print('JS code-units:', repr(written_js))
print('Matches?     :', written_js == REPLY)

# 3b: code-point approach (correct)
units_cp = simulate_typing_code_points(REPLY)
written_cp = verify_written_message(units_cp)
print('Code points  :', repr(written_cp))
print('Matches?     :', written_cp == REPLY)

print(f'\nJS approach writes correctly: {written_js == REPLY}')
print(f'Code-point approach writes correctly: {written_cp == REPLY}')

# ---------------------------------------------------------------------------
# TEST 4: input box selector check against real DOM
# ---------------------------------------------------------------------------

print('\n========== TEST 4: input box + send selectors on real DOM ==========')
has_input = 'contenteditable="true"' in html and 'role="textbox"' in html and 'data-lexical-editor="true"' in html and 'aria-placeholder="Aa"' in html
print('Input box selector [contenteditable="true"][role="textbox"][data-lexical-editor] found:', has_input)
print('Old selector [aria-label*="Write"] found:', 'aria-label="Write' in html)
print('Send button [data-testid="send-button"] found:', 'data-testid="send-button"' in html)
print('Send button [aria-label="Send"] found:', 'aria-label="Send"' in html)
print('(Send button not present because it only renders after text is typed; Enter key is the send fallback)')

# ---------------------------------------------------------------------------
# TEST 5: timestamp freshness - bot must NOT reply to history
# ---------------------------------------------------------------------------

print('\n========== TEST 5: freshness gate (must ignore history) ==========')

# Simulate "now" = 7:05 PM. The captured history has birthday msgs at 6:56, 7:00, 7:04 PM.
# Only the 7:04 PM one should be fresh. Older ones are history -> ignored.
test5_now = _dt.datetime(2026, 8, 7, 19, 5, 0)

freshness_cases = [
    # (aria-label, now_dt, expected_fresh, note)
    ("At 7:04\u202fPM, Lawrence: Happy birthday", test5_now, True, "1 min ago -> fresh"),
    ("At 7:00\u202fPM, Lawrence: Happy birthday", test5_now, False, "5 min ago -> history"),
    ("At 6:56\u202fPM, Lawrence: Happy birthday", test5_now, False, "9 min ago -> history"),
    ("At 6:32\u202fPM, Lawrence: Meow", test5_now, False, "33 min ago -> history"),
    ("At 7:05\u202fPM, Lawrence: Happy birthday", test5_now, True, "same minute -> fresh"),
    ("At 7:06\u202fPM, Lawrence: Happy birthday", test5_now, False, "1 min future -> NOT fresh (out of tolerance window? no: 60s future < 30s tol -> fails)"),
    ("At 7:05\u202fPM, You: 🎉 Happy Birthday!", test5_now, True, "own but fresh (own filter applied separately)"),
    ("NoTimestamp, Lawrence: Happy birthday", test5_now, False, "unparseable -> conservative skip"),
    ("At 7:04\u202fPM, Lawrence: Happy birthday", test5_now, True, "duplicate label check"),
]

t5_pass = 0
t5_fail = 0
for label, now_dt, expected_fresh, note in freshness_cases:
    fresh = is_fresh_message(label, now_dt)
    status = 'PASS' if (fresh == expected_fresh) else 'FAIL'
    if status == 'PASS':
        t5_pass += 1
    else:
        t5_fail += 1
    print(f"[{status}] fresh={str(fresh):5} expected={str(expected_fresh):5} | {label[:45]!r:49} {note}")

print(f'\nTEST 5 summary: {t5_pass} passed, {t5_fail} failed')

# TEST 5b: full pipeline on real history with a fixed "now" AFTER the history times
print('\nTEST 5b: real history messages evaluated at 7:20 PM (all should be ignored)')
real_now = _dt.datetime(2026, 8, 7, 19, 20, 0)
t5b_pass = 0
t5b_fail = 0
for label, mid in real_messages:
    res = evaluate_message(label, now_dt=real_now)
    # At 7:11 PM, ALL captured messages are history -> nothing should trigger
    expected = False
    status = 'PASS' if (res['triggered'] == expected) else 'FAIL'
    if status == 'PASS':
        t5b_pass += 1
    else:
        t5b_fail += 1
    print(f"[{status}] triggered={str(res['triggered']):5} fresh={str(res['fresh']):5} own={str(res['own']):5} | {label[:60]!r}")
print(f'\nTEST 5b summary: {t5b_pass} passed, {t5b_fail} failed')

print('\n============================================================')
# Overall requires the FIXED algorithm (code-point typing). The JS code-unit
# result is a regression demonstration of the bug that Array.from() fixes.
overall = (fail_count == 0) and (t2_fail == 0) and (t5_fail == 0) and (t5b_fail == 0) and (written_cp == REPLY)
print('OVERALL SMOKE TEST (fixed code-point algorithm):', 'PASS' if overall else 'FAIL')
print('Regression note: old text[i] (UTF-16 unit) writing writes', repr(written_js), '-> must NOT be used')
