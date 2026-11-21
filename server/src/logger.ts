import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL?.trim() || 'info',
  redact: {
    paths: [
      'pin',
      'apiKey',
      'req.headers.cookie',
      'req.headers.authorization',
      'note',
      '*.pin',
      '*.apiKey',
      '*.note',
    ],
    remove: true,
  },
});
