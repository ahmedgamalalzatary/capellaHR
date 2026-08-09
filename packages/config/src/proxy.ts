export const resolveApiProxyTarget = (value = process.env.API_PROXY_TARGET) => {
  const url = new URL(value ?? 'http://localhost:4000');
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API_PROXY_TARGET must be an HTTP(S) origin without credentials or a path');
  }
  return url.origin;
};
