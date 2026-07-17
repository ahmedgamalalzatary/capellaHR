import { hash, verify } from 'argon2';

export const validateEmployeePin = (pin: string): boolean => /^\d{4}$/.test(pin);

export const hashEmployeePin = async (pin: string): Promise<string> => {
  if (!validateEmployeePin(pin)) throw new Error('Employee PIN must contain exactly four digits');
  return hash(pin);
};

export const verifyEmployeePin = async (pinHash: string, pin: string): Promise<boolean> => {
  if (!validateEmployeePin(pin)) return false;
  try {
    return await verify(pinHash, pin);
  } catch {
    return false;
  }
};

export * from './auth-service.js';
export * from './auth-router.js';
export * from './auth-repositories.js';
export * from './auth-middleware.js';
export * from './auth-module.js';
