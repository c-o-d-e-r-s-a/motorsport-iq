import { describe, expect, it } from '@jest/globals';
import { buildLobbyShareUrl, getPublicAppOrigin } from './shareUrl';

describe('shareUrl', () => {
  it('prefers a non-localhost origin from CORS_ORIGIN', () => {
    expect(
      getPublicAppOrigin('http://localhost:3000,https://motorsport-iq.vercel.app')
    ).toBe('https://motorsport-iq.vercel.app');
  });

  it('falls back to localhost when only local origins are configured', () => {
    expect(getPublicAppOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('builds a lobby invite URL', () => {
    expect(buildLobbyShareUrl('abc123', 'https://motorsport-iq.vercel.app')).toBe(
      'https://motorsport-iq.vercel.app/lobby/ABC123'
    );
  });
});
