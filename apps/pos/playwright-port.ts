export const parseE2ePort = (value: string | undefined) => {
  const port = Number(value);
  if (!value || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('POS_E2E_PORT must be an integer between 1 and 65535');
  }
  return port;
};
