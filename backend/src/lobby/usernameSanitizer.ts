import Filter from 'bad-words';
import Groq from 'groq-sdk';

// ---------------------------------------------------------------------------
// Groq AI moderation — the definitive final layer.
// Catches creative obfuscations, cultural slang, and contextual meanings that
// no rule-based filter can enumerate in advance.
//
// Uses GROQ_MODERATION_KEY if set (recommended: a dedicated key so moderation
// quota is fully isolated from gameplay explanation/hint calls).
// Falls back to GROQ_API_KEY when the dedicated key is absent.
// ---------------------------------------------------------------------------
const groqApiKey = process.env.GROQ_MODERATION_KEY ?? process.env.GROQ_API_KEY;
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
const AI_MODERATION_TIMEOUT_MS = 2500;

const AI_SYSTEM_PROMPT =
  'You are a strict content moderator for a family-friendly Formula 1 racing game. ' +
  'Your only job: decide if a player username is appropriate to display publicly to all ages. ' +
  'A username is INAPPROPRIATE if it contains or implies — through any means including creative ' +
  'spelling, leet speak, repeated characters, phonetic substitution, abbreviations, concatenation, ' +
  'cultural slang, or double meanings — any of the following: profanity, sexual content, ' +
  'hate speech, racial or ethnic slurs, homophobic or transphobic language, drug references, ' +
  'graphic violence, or any content that would embarrass a family audience. ' +
  'When in doubt, mark as inappropriate. Be strict. ' +
  'Respond with ONLY valid JSON and nothing else: {"appropriate":true} or {"appropriate":false}';

/**
 * Ask Groq whether the username is appropriate.
 * Returns true if the AI considers it inappropriate (i.e. should be blocked).
 * Returns false on any error or timeout — the pre-filter result is trusted instead.
 */
async function aiConsidersInappropriate(username: string): Promise<boolean> {
  if (!groq) return false;

  try {
    const completion = await Promise.race([
      groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: `Username: "${username}"` },
        ],
        temperature: 0,
        max_tokens: 20,
        response_format: { type: 'json_object' },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('AI moderation timed out')),
          AI_MODERATION_TIMEOUT_MS
        )
      ),
    ]);

    const text = completion.choices[0]?.message?.content ?? '{}';
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'appropriate' in parsed) {
      return (parsed as { appropriate: boolean }).appropriate === false;
    }
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[usernameSanitizer] AI moderation skipped:', msg);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Leet-speak / symbol substitution maps
// Two variants for the ambiguous "1" glyph (used as both "l" and "i").
// Both are checked so "sh1t" (1→i) and "1337" (1→l) are handled correctly.
// ---------------------------------------------------------------------------
const LEET_MAP_PRIMARY: Record<string, string> = {
  '0': 'o',
  '1': 'l', // primary: 1 → l
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'b',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '|': 'l',
  '+': 't',
};

const LEET_MAP_ALT: Record<string, string> = {
  ...LEET_MAP_PRIMARY,
  '1': 'i', // alt: 1 → i  (catches sh1t, b1tch, n1gger, etc.)
};

// ---------------------------------------------------------------------------
// Extended words not in bad-words v3 default dictionary.
// ---------------------------------------------------------------------------
const EXTENDED_BAD_WORDS: string[] = [
  // f-word family
  'fook', 'fooking', 'fooks', 'fookd', 'fooker', 'fookers',
  'fuk', 'fuking', 'fuker', 'fukr', 'fukk', 'fukking',
  'f0k', 'f0king', 'phuck', 'phuk', 'phuking', 'phucker',
  'fcuk', 'feck', 'feckin', 'fecking', 'fecker', 'feckers',
  'frig', 'frigging',
  // s-word family
  'sht', 'sh1t', 'shiz', 'shyte', 'shiit', 'shitt',
  // c-word family
  'cnt', 'cnut',
  // b-word family
  'biatch', 'byatch', 'b1tch', 'bytch',
  // a-word family
  'azz', 'arse', 'arsehole', 'azzhole',
  // n-word family
  'nigg', 'nigga', 'niggas', 'niggaz', 'nigger', 'niggers',
  'n1gg', 'n1gga', 'n1gger',
  // other slurs / serious insults
  'kike', 'kikes', 'spick', 'spics', 'chink', 'chinks',
  'retard', 'retards', 'retarded',
  'fag', 'fags', 'faggot', 'faggots',
  'dyke', 'dykes',
  'twat', 'twats',
  'wank', 'wanker', 'wankers', 'wanking',
  'prick', 'pricks',
  'slag', 'slags',
  'skank', 'skanky',
  'whore', 'whores',
  'cumshot', 'cumshots',
];

// ---------------------------------------------------------------------------
// Nuclear list: checked as raw substrings in the compacted (no-spaces) form.
// Only add roots where ANY occurrence inside a longer word is unambiguously
// offensive.  Kept short and high-confidence to minimise false positives.
// ---------------------------------------------------------------------------
const NUCLEAR_SUBSTRINGS: string[] = [
  // f-word roots (covers fock, fack, phuck, etc. after normalization)
  'fuck', 'fook', 'fuk', 'fock', 'fack', 'phuck', 'phuk',
  // "faak": catches FAAAAAK / FAAAAK / FAAK (2+ a's) after collapse-to-2.
  // "fake" never normalises to "faak" so there are no false positives here.
  'faak',
  // c-word
  'cunt',
  // n-word
  'nigger', 'nigga',
  // b-word
  'bitch',
  // wanker
  'wanker',
];

// ---------------------------------------------------------------------------
// Nuclear regex patterns: for cases where a plain substring check would
// produce false positives, but a context-aware regex is safe.
// All patterns are tested against the compact (no non-alpha) normalized form.
// ---------------------------------------------------------------------------
const NUCLEAR_PATTERNS: RegExp[] = [
  // "fak" not followed by "e" — blocks FAK/faking/fakoff but allows "fake"/"faker"/"fakery"
  /fak(?!e)/,
];

// ---------------------------------------------------------------------------
// Build the filter once at module load.
// ---------------------------------------------------------------------------
const profanityFilter = new Filter();
profanityFilter.addWords(...EXTENDED_BAD_WORDS);

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function applyLeetMap(s: string, map: Record<string, string>): string {
  return s.replace(/[013456789@$!|+]/g, (ch) => map[ch] ?? ch);
}

function applyPhoneticSwaps(s: string): string {
  return s.replace(/ph/g, 'f');
}

/**
 * Collapse 3+ consecutive identical chars to exactly 2.
 * "hellllll" → "hell",  "fuuuuuck" → "fuuck".
 */
function collapseToTwo(s: string): string {
  return s.replace(/(.)\1{2,}/g, '$1$1');
}

/**
 * Collapse ALL consecutive identical chars to exactly 1.
 * "fuuck" → "fuck", "biitch" → "bitch".
 */
function collapseToOne(s: string): string {
  return s.replace(/(.)\1+/g, '$1');
}

/**
 * Insert a space before each uppercase letter so camelCase names split
 * into individual tokens for dictionary matching.
 * "fookingHell" → "fooking Hell"
 */
function splitCamelCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Full normalization pipeline for a given leet map:
 * camelCase split → lowercase → leet map → ph→f → collapse-to-2.
 */
function normalize(username: string, leetMap: Record<string, string>): string {
  let s = splitCamelCase(username);
  s = s.toLowerCase();
  s = applyLeetMap(s, leetMap);
  s = applyPhoneticSwaps(s);
  s = collapseToTwo(s);
  return s;
}

// ---------------------------------------------------------------------------
// Rule-based pre-filter (synchronous, no API call)
// ---------------------------------------------------------------------------

/**
 * Run all rule-based checks against one normalized candidate string.
 * Returns true if any layer detects profanity.
 */
function checkCandidate(normalized: string): boolean {
  // 1. Dictionary check on normalized string (handles camelCase, leet, repeated chars).
  if (profanityFilter.isProfane(normalized)) return true;

  // 2. Separators (_, -, .) replaced with spaces so "f_uck" becomes "f uck".
  const spacedOut = normalized.replace(/[_\-.]+/g, ' ');
  if (profanityFilter.isProfane(spacedOut)) return true;

  // 3. All non-alpha stripped ("f.u.c.k" → "fuck").
  const alphaOnly = normalized.replace(/[^a-z ]/g, '');
  if (profanityFilter.isProfane(alphaOnly)) return true;

  // 4. Aggressive collapse to 1 then dictionary check
  //    ("fuuck" → "fuck", "biitch" → "bitch").
  const collapsed = collapseToOne(normalized);
  if (profanityFilter.isProfane(collapsed)) return true;
  if (profanityFilter.isProfane(collapsed.replace(/[^a-z ]/g, ''))) return true;

  // 5. Nuclear substring scan on compact form (no non-alpha chars).
  //    Catches bad roots embedded inside concatenated words.
  const compact = normalized.replace(/[^a-z]/g, '');
  for (const badSub of NUCLEAR_SUBSTRINGS) {
    if (compact.includes(badSub)) return true;
  }

  // 6. Same scan on aggressively collapsed compact form.
  const compactCollapsed = collapseToOne(compact);
  for (const badSub of NUCLEAR_SUBSTRINGS) {
    if (compactCollapsed.includes(badSub)) return true;
  }

  // 7. Regex nuclear patterns — context-aware checks that can't be expressed
  //    as plain substrings (e.g. "fak" not followed by "e").
  //    Run against both the compact and collapsed compact forms.
  for (const pattern of NUCLEAR_PATTERNS) {
    if (pattern.test(compact) || pattern.test(compactCollapsed)) return true;
  }

  return false;
}

function ruleBasedIsProfane(username: string): boolean {
  const normPrimary = normalize(username, LEET_MAP_PRIMARY);
  const normAlt = normalize(username, LEET_MAP_ALT);
  return checkCandidate(normPrimary) || checkCandidate(normAlt);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function randomRacerUsername(): string {
  const rand = Math.floor(Math.random() * 900_000) + 100_000;
  return `Racer_${rand}`;
}

/**
 * Sanitize a username for use in a public lobby.
 *
 * Two-stage check:
 *
 * Stage 1 — Rule-based pre-filter (synchronous, instant):
 *   Applies 7 layers across two leet-speak interpretations (1→l and 1→i):
 *   a) Dictionary filter (bad-words + 50+ custom extended words) on normalized string.
 *   b) Same with separator chars replaced by spaces.
 *   c) Same with all non-alpha stripped.
 *   d) Dictionary check after aggressively collapsing all repeated chars to 1.
 *   e) Substring scan against a curated nuclear list of unambiguous roots.
 *   f) Same scan on the aggressively collapsed form.
 *   g) Regex nuclear patterns for context-aware root detection.
 *   If any layer fires → immediately return Racer_XXXXXX (no API call needed).
 *
 * Stage 2 — Groq AI semantic moderation (async, ~200–500 ms):
 *   Sends the username to llama-3.3-70b with a strict moderator system prompt.
 *   Catches creative obfuscations, cultural slang, and contextual meanings that
 *   no rule-based filter can enumerate in advance.
 *   If Groq is unavailable or times out → trust stage 1 result and allow the name.
 *
 * On any unexpected error the safe Racer_XXXXXX fallback is returned.
 */
export async function sanitizeUsernameForPublic(username: string): Promise<string> {
  try {
    // Stage 1: fast synchronous pre-filter
    if (ruleBasedIsProfane(username)) {
      return randomRacerUsername();
    }

    // Stage 2: AI semantic check — the definitive safety net
    const blocked = await aiConsidersInappropriate(username);
    if (blocked) {
      console.log(`[usernameSanitizer] AI blocked username: "${username}"`);
      return randomRacerUsername();
    }
  } catch (error) {
    console.error('[usernameSanitizer] Unexpected error; defaulting username:', error);
    return randomRacerUsername();
  }

  return username;
}
