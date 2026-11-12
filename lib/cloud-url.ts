export function cloudApiUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !url.hostname.endsWith('.up.railway.app')) {
    throw new Error('Flownote API requires a public Railway HTTPS URL.');
  }
  return url.origin;
}
