import { ApiError, type ApiErrorStatus } from '@nocobase/app-server/router';
export function reportError(
  status: ApiErrorStatus,
  reason: string,
  message: string,
): ApiError {
  return new ApiError({ status, reason, message, domain: 'project-reports' });
}
