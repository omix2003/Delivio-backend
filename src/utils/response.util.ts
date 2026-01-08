import { Response } from 'express';

/**
 * Standardized API response utilities
 * Provides consistent response formats across the application
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    [key: string]: any;
  };
}

/**
 * Send a successful response
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string,
  statusCode: number = 200,
  meta?: ApiResponse<T>['meta']
): Response {
  const response: ApiResponse<T> = {
    success: true,
    data,
    ...(message && { message }),
    ...(meta && { meta }),
  };
  return res.status(statusCode).json(response);
}

/**
 * Send an error response
 */
export function sendError(
  res: Response,
  error: string,
  statusCode: number = 400,
  details?: any
): Response {
  const response: ApiResponse = {
    success: false,
    error,
    ...(details && { details }),
  };
  return res.status(statusCode).json(response);
}

/**
 * Send a not found response
 */
export function sendNotFound(res: Response, resource: string = 'Resource'): Response {
  return sendError(res, `${resource} not found`, 404);
}

/**
 * Send an unauthorized response
 */
export function sendUnauthorized(res: Response, message: string = 'Unauthorized'): Response {
  return sendError(res, message, 401);
}

/**
 * Send a forbidden response
 */
export function sendForbidden(res: Response, message: string = 'Forbidden'): Response {
  return sendError(res, message, 403);
}

/**
 * Send a validation error response
 */
export function sendValidationError(res: Response, errors: string | string[]): Response {
  const errorMessage = Array.isArray(errors) ? errors.join(', ') : errors;
  return sendError(res, `Validation error: ${errorMessage}`, 400);
}












