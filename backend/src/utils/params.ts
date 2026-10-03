import { Request } from 'express';

/**
 * Safely parse a route parameter as integer.
 * Express params can be string | string[], this helper handles both.
 */
export function parseParamInt(param: string | string[] | undefined): number {
  if (Array.isArray(param)) return parseInt(param[0] || '0', 10);
  return parseInt(param || '0', 10);
}

/**
 * Get a body field as string safely.
 */
export function bodyStr(value: unknown): string {
  if (typeof value === 'string') return value;
  return '';
}
