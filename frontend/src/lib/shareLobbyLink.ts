export type ShareLobbyLinkResult = 'shared' | 'copied' | 'cancelled';

export async function shareLobbyLink(options: {
  url: string;
  code: string;
}): Promise<ShareLobbyLinkResult> {
  const title = 'Join my Motorsport IQ lobby';
  const text = `Join lobby ${options.code} on Motorsport IQ`;

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url: options.url });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  await navigator.clipboard.writeText(options.url);
  return 'copied';
}
