import { sanitizeUsernameForPublic } from './usernameSanitizer';

const RACER_PATTERN = /^Racer_\d{6}$/;

async function expectBlocked(name: string) {
  const result = await sanitizeUsernameForPublic(name);
  expect(result).toMatch(RACER_PATTERN);
}

async function expectAllowed(name: string) {
  expect(await sanitizeUsernameForPublic(name)).toBe(name);
}

describe('moderation toggle', () => {
  const previousValue = process.env.USERNAME_MODERATION_ENABLED;

  afterEach(() => {
    if (previousValue === undefined) {
      delete process.env.USERNAME_MODERATION_ENABLED;
    } else {
      process.env.USERNAME_MODERATION_ENABLED = previousValue;
    }
  });

  it('allows usernames unchanged when moderation is disabled', async () => {
    process.env.USERNAME_MODERATION_ENABLED = 'false';

    expect(await sanitizeUsernameForPublic('fuck')).toBe('fuck');
  });
});

// ---------------------------------------------------------------------------
// Clean names — must pass through unchanged
// ---------------------------------------------------------------------------
describe('clean usernames pass through', () => {
  it.each([
    'Alice',
    'Max33',
    'SpeedRacer',
    'Hamilton44',
    'LeClerc16',
    'VerstappenFan',
    'GrandPrix2026',
    'RaceDay',
    'FastLap99',
    'PitStop',
    'Apex_Hunter',
    'Tifosi',
  ])('allows %s', (name) => expectAllowed(name));
});

// ---------------------------------------------------------------------------
// Straightforward bad words
// ---------------------------------------------------------------------------
describe('blocks plain bad words', () => {
  it.each([
    'shit',
    'fuck',
    'cunt',
    'bitch',
    'asshole',
    'nigger',
    'nigga',
    'prick',
    'wanker',
    'twat',
  ])('blocks %s', (name) => expectBlocked(name));
});

// ---------------------------------------------------------------------------
// Repeated-character obfuscation (the "fookingHellllll" class)
// ---------------------------------------------------------------------------
describe('blocks repeated-char obfuscations', () => {
  it('blocks fookingHellllll', () => expectBlocked('fookingHellllll'));
  it('blocks fooooook', () => expectBlocked('fooooook'));
  it('blocks shiiiiit', () => expectBlocked('shiiiiit'));
  it('blocks fuuuuuck', () => expectBlocked('fuuuuuck'));
  it('blocks cuuunt', () => expectBlocked('cuuunt'));
  it('blocks biiiitch', () => expectBlocked('biiiitch'));
});

// ---------------------------------------------------------------------------
// CamelCase splitting
// ---------------------------------------------------------------------------
describe('blocks camelCase obfuscations', () => {
  it('blocks FookingHell', () => expectBlocked('FookingHell'));
  it('blocks FuckingIdiot', () => expectBlocked('FuckingIdiot'));
  it('blocks BiggerShit', () => expectBlocked('BiggerShit'));
  it('blocks WankingAround', () => expectBlocked('WankingAround'));
});

// ---------------------------------------------------------------------------
// Leet-speak / symbol substitution
// ---------------------------------------------------------------------------
describe('blocks leet-speak substitutions', () => {
  it('blocks f0ck', () => expectBlocked('f0ck'));
  it('blocks $hit', () => expectBlocked('$hit'));
  it('blocks sh1t', () => expectBlocked('sh1t'));
  it('blocks b1tch', () => expectBlocked('b1tch'));
  it('blocks @sshole', () => expectBlocked('@sshole'));
  it('blocks n1gger', () => expectBlocked('n1gger'));
  it('blocks f4ck', () => expectBlocked('f4ck'));
  it('blocks 5h1t', () => expectBlocked('5h1t'));
});

// ---------------------------------------------------------------------------
// Separator tricks (underscores, dots, dashes)
// ---------------------------------------------------------------------------
describe('blocks separator tricks', () => {
  it('blocks f_uck', () => expectBlocked('f_uck'));
  it('blocks f.u.c.k', () => expectBlocked('f.u.c.k'));
  it('blocks f-u-c-k', () => expectBlocked('f-u-c-k'));
  it('blocks sh_it', () => expectBlocked('sh_it'));
});

// ---------------------------------------------------------------------------
// Phonetic swaps (ph→f)
// ---------------------------------------------------------------------------
describe('blocks phonetic swaps', () => {
  it('blocks phuck', () => expectBlocked('phuck'));
  it('blocks phuking', () => expectBlocked('phuking'));
  it('blocks phucker', () => expectBlocked('phucker'));
});

// ---------------------------------------------------------------------------
// Extended custom words (fook family, feck family, etc.)
// ---------------------------------------------------------------------------
describe('blocks extended custom words', () => {
  it('blocks fook', () => expectBlocked('fook'));
  it('blocks fooking', () => expectBlocked('fooking'));
  it('blocks fecker', () => expectBlocked('fecker'));
  it('blocks fecking', () => expectBlocked('fecking'));
  it('blocks wanker', () => expectBlocked('wanker'));
  it('blocks twat', () => expectBlocked('twat'));
  it('blocks frig', () => expectBlocked('frig'));
});

// ---------------------------------------------------------------------------
// Combined obfuscation (leet + repeated + camelCase)
// ---------------------------------------------------------------------------
describe('blocks combined multi-layer obfuscations', () => {
  it('blocks F00kingHellllll', () => expectBlocked('F00kingHellllll'));
  it('blocks Sh1ttyDriv3r', () => expectBlocked('Sh1ttyDriv3r'));
  it('blocks $hitHead', () => expectBlocked('$hitHead'));
  it('blocks WankerFace99', () => expectBlocked('WankerFace99'));
  it('blocks PhuckYou', () => expectBlocked('PhuckYou'));
  it('blocks fooooookingRacer', () => expectBlocked('fooooookingRacer'));
  it('blocks c_u_n_t', () => expectBlocked('c_u_n_t'));
});

// ---------------------------------------------------------------------------
// All-caps repeated-vowel obfuscations ("FAAAAAK" class)
// ---------------------------------------------------------------------------
describe('blocks all-caps repeated-vowel obfuscations', () => {
  it('blocks FAAAAAK', () => expectBlocked('FAAAAAK'));
  it('blocks FAAAAK', () => expectBlocked('FAAAAK'));
  it('blocks FAAK', () => expectBlocked('FAAK'));
  it('blocks FUUUUUCK', () => expectBlocked('FUUUUUCK'));
  it('blocks SHIIIIT', () => expectBlocked('SHIIIIT'));
  it('blocks IWantToFAAAAK', () => expectBlocked('IWantToFAAAAK'));
});

// ---------------------------------------------------------------------------
// "fake" and similar clean words must NOT be blocked (false-positive guard)
// ---------------------------------------------------------------------------
describe('does not block legitimate names containing fak/fake', () => {
  it('allows FakeRacer', () => expectAllowed('FakeRacer'));
  it('allows Faker99', () => expectAllowed('Faker99'));
  it('allows FastLap', () => expectAllowed('FastLap'));
});
