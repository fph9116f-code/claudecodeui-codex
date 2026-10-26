import express from 'express';
import type { Request, Response } from 'express';

import { chatQueueService } from '@/modules/chat-queue/services/chat-queue.service.js';
import {
  canInsertIntoSession,
  steerMessageNow,
  tryInsertQueuedMessageNow,
} from '@/modules/chat-queue/services/chat-queue-dispatcher.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

type AuthenticatedRequest = Request & { user?: { id?: number | string } };

function readUserId(request: Request): number {
  const userId = Number((request as AuthenticatedRequest).user?.id);
  if (!Number.isInteger(userId)) {
    throw new AppError('Authenticated user is required.', {
      code: 'USER_REQUIRED',
      statusCode: 401,
    });
  }
  return userId;
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('A queued message id is required.', {
      code: 'QUEUE_MESSAGE_ID_REQUIRED',
      statusCode: 400,
    });
  }
  return value.trim();
}

function readOptionalVersion(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const version = Number(value);
  if (!Number.isInteger(version)) {
    throw new AppError('version must be an integer when provided.', {
      code: 'INVALID_QUEUE_VERSION',
      statusCode: 400,
    });
  }
  return version;
}

const router = express.Router();

// One session's queue plus whether a failure is pausing it.
router.get(
  '/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = readId(req.params.sessionId);
    const snapshot = chatQueueService.list(readUserId(req), sessionId);
    // The runtime's live-turn state, not the composer's possibly stale view,
    // decides whether an "insert now" button makes sense.
    res.json(createApiSuccessResponse({
      ...snapshot,
      canInsert: canInsertIntoSession(sessionId),
    }));
  }),
);

// Queue a message behind the session's current/next turn.
router.post(
  '/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = chatQueueService.append({
      userId: readUserId(req),
      sessionId: body.sessionId,
      requestId: body.requestId,
      content: body.content,
      options: body.options,
      attachments: body.attachments,
    });
    res.status(201).json(createApiSuccessResponse(message));
  }),
);

// Edit a still-pending message; the version guards against a stale editor.
router.patch(
  '/messages/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = chatQueueService.edit({
      userId: readUserId(req),
      id: readId(req.params.id),
      version: body.version,
      content: body.content,
      options: body.options,
      attachments: body.attachments,
    });
    res.json(createApiSuccessResponse(message));
  }),
);

// Remove a pending message. A message already being sent is refused.
router.delete(
  '/messages/:id',
  asyncHandler(async (req: Request, res: Response) => {
    chatQueueService.remove(
      readUserId(req),
      readId(req.params.id),
      readOptionalVersion(req.query.version)
    );
    res.json(createApiSuccessResponse({ removed: true }));
  }),
);

// Explicitly re-run a failed (or outcome-unknown) message and resume the queue.
router.post(
  '/messages/:id/retry',
  asyncHandler(async (req: Request, res: Response) => {
    const message = chatQueueService.retry(readUserId(req), readId(req.params.id));
    res.json(createApiSuccessResponse(message));
  }),
);

// Submit a message that steers the running turn. If the turn has already
// ended, the message is kept in the queue instead and `inserted` says so.
router.post(
  '/messages/steer',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await steerMessageNow(readUserId(req), {
      sessionId: body.sessionId,
      requestId: body.requestId,
      content: body.content,
      options: body.options,
      attachments: body.attachments,
    });
    res.status(201).json(createApiSuccessResponse(result));
  }),
);

// Steer the turn already in flight: insert this message into the current run.
// When the turn has already ended, `inserted:false` says the message stays
// queued instead of failing the action.
router.post(
  '/messages/:id/insert',
  asyncHandler(async (req: Request, res: Response) => {
    const inserted = await tryInsertQueuedMessageNow(readUserId(req), readId(req.params.id));
    res.json(createApiSuccessResponse({ inserted }));
  }),
);

// Continue past a failed message without re-running it.
router.post(
  '/messages/:id/skip',
  asyncHandler(async (req: Request, res: Response) => {
    chatQueueService.skip(readUserId(req), readId(req.params.id));
    res.json(createApiSuccessResponse({ skipped: true }));
  }),
);

export default router;
