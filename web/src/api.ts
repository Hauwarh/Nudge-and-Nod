export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(
      0,
      'The house did not answer. If this host has been asleep, give it a minute and try again.',
    );
  }
  const text = await response.text();
  const body = text ? (JSON.parse(text) as { message?: string; error?: string }) : {};
  if (!response.ok) {
    throw new ApiError(response.status, body.message || 'Something went wrong.', body.error);
  }
  return body as T;
}
