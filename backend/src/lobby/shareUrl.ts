const DEFAULT_PUBLIC_APP_ORIGIN = 'https://motorsport-iq.vercel.app';

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * Public frontend origin used in lobby invite links.
 * Prefers the first non-localhost origin from CORS_ORIGIN, then any configured origin.
 */
export function getPublicAppOrigin(corsOriginEnv: string | undefined): string {
  const origins = (corsOriginEnv ?? '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  const publicOrigin = origins.find((origin) => !/localhost|127\.0\.0\.1/i.test(origin));
  if (publicOrigin) {
    return publicOrigin;
  }

  if (origins.length > 0) {
    return origins[0];
  }

  return DEFAULT_PUBLIC_APP_ORIGIN;
}

export function buildLobbyShareUrl(code: string, corsOriginEnv: string | undefined): string {
  const origin = getPublicAppOrigin(corsOriginEnv);
  return `${origin}/lobby/${encodeURIComponent(code.toUpperCase())}`;
}

export function enrichLobbyState<T extends { code: string }>(
  state: T,
  corsOriginEnv: string | undefined = process.env.CORS_ORIGIN
): T & { shareUrl: string } {
  return {
    ...state,
    shareUrl: buildLobbyShareUrl(state.code, corsOriginEnv),
  };
}
