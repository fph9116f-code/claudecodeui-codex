import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants';
import { readUserPreference } from '@/shared/userSettings';
import type { ChatQueueMessage, ChatQueueSnapshot, CommandModalPayload, CostCommandData, HelpCommandData, MarkSessionProcessing, ModelCommandData, SessionActivityMap, StatusCommandData,QueuedSendOptions,ChatAttachment,ChatMessage,PendingPermissionRequest,PermissionMode,SessionEstablishedContext,Project,ProjectSession,LLMProvider,SlashCommand } from '@/shared/types';
import { grantClaudeToolPermission } from '@/modules/chat/utils/chatPermissions';
import {
  readDraftText,
  subscribeToChatDrafts,
  writeDraftText,
} from '@/shared/chatDrafts';
import { escapeRegExp } from '@/modules/chat/utils/chatFormatting';
import { useFileMentions } from '@/modules/chat/hooks/useFileMentions';
import { useInputHistory } from '@/modules/chat/hooks/useInputHistory';
import { useSlashCommands } from '@/modules/chat/hooks/useSlashCommands';

type UseChatComposerStateArgs = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  resolvePermissionModeForProvider: (provider: LLMProvider, requestedMode: PermissionMode | string) => PermissionMode;
  /**
   * Model every send and command carries: the open session's model when there
   * is one, otherwise the user's per-provider selection.
   */
  currentProviderModel: string;
  currentProviderEffort: string;
  isLoading: boolean;
  processingSessions?: SessionActivityMap;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionProcessing?: MarkSessionProcessing;
  /**
   * Invoked with the freshly allocated session id when the user sends the
   * first message of a brand-new conversation. The backend allocates the id
   * via POST /api/providers/sessions BEFORE the websocket send, so the id is
   * stable for the conversation's whole lifetime — the consumer navigates to
   * /session/:id and records it as the current session.
   */
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  scrollToBottom: () => void;
  addMessage: (msg: ChatMessage) => void;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
};

type MentionableFile = {
  name: string;
  path: string;
};

type CommandExecutionResult = {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
};





type SubmitOptions = {
  /**
   * Send the text as a chat message even when it starts with "/" (or is
   * "help"). Set only for the re-submit of a custom command's expanded body:
   * like the Claude Code CLI, that body is never read as a command again, so a
   * body that opens with its own or another command's name cannot loop or
   * run that command instead of being sent.
   */
  skipCommandInterception?: boolean;
  /**
   * Steer the turn in flight instead of queueing behind it. The message is
   * still stored in the queue first, so an ended turn just leaves it queued.
   */
  insertNow?: boolean;
};

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const isImageAttachment = (attachment: ChatAttachment) => {
  if (attachment.mimeType?.startsWith('image/')) return true;
  return /\.(gif|jpe?g|png|svg|webp)$/i.test(attachment.path || attachment.name || '');
};

const uploadAttachmentFiles = async (files: File[]): Promise<unknown[]> => {
  if (files.length === 0) {
    return [];
  }

  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await api.assets.uploadFiles(formData);

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'Failed to upload files');
  }

  const result = await response.json();
  if (!Array.isArray(result.attachments) || result.attachments.length !== files.length) {
    throw new Error('File upload returned an incomplete result');
  }
  return result.attachments;
};


/** Idempotency key for one submit, so a retried request queues the message once. */
const createQueueRequestId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

/**
 * Reads the server's error envelope. The API nests the reason as
 * `{ error: { code, message } }`; handing that object to `Error` would surface
 * an unhelpful "[object Object]" and hide why the action was refused.
 */
const readApiErrorMessage = (body: unknown, fallback: string): string => {
  if (!body || typeof body !== 'object') {
    return fallback;
  }
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === 'string' && error) {
    return error;
  }
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message) {
      return message;
    }
  }
  if (typeof record.message === 'string' && record.message) {
    return record.message;
  }
  return fallback;
};

const getNotificationSessionSummary = (
  selectedSession: ProjectSession | null,
  fallbackInput: string,
): string | null => {
  const sessionSummary = selectedSession?.summary || selectedSession?.name || selectedSession?.title;
  if (typeof sessionSummary === 'string' && sessionSummary.trim()) {
    const normalized = sessionSummary.replace(/\s+/g, ' ').trim();
    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  }

  const normalizedFallback = fallbackInput.replace(/\s+/g, ' ').trim();
  if (!normalizedFallback) {
    return null;
  }

  return normalizedFallback.length > 80 ? `${normalizedFallback.slice(0, 77)}...` : normalizedFallback;
};

/**
 * Enter that CONFIRMS an IME candidate must not also submit.
 *
 * `event.isComposing` alone is not enough: Safari fires `compositionend` BEFORE the confirming
 * Enter's `keydown`, so the flag is already `false` by the time the handler runs. Chrome and
 * Firefox fire it after, which is why the naive guard looks correct on those two and the bug
 * reads as Safari-only. A tight window after `compositionend` covers it — that sequence is
 * synchronous (microseconds), while a human pressing Enter a second time takes >= 100ms and
 * never lands inside it.
 */
const SAFARI_IME_RACE_WINDOW_MS = 30;

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  provider,
  permissionMode,
  cyclePermissionMode,
  resolvePermissionModeForProvider,
  currentProviderModel,
  currentProviderEffort,
  isLoading,
  processingSessions,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionProcessing,
  onSessionEstablished,
  onFileOpen,
  onShowSettings,
  scrollToBottom,
  addMessage,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
}: UseChatComposerStateArgs) {
  const { t } = useTranslation('chat');
  // The composer text together with the chat scope it belongs to. They are one
  // state rather than a value plus a ref because they have to move in lockstep:
  // on a session switch there is one commit where the scope has already changed
  // while the text has not, and anything that persisted the text in that commit
  // would write the previous session's message into the new session's draft.
  // A ref cannot express this — React evaluates a state updater eagerly, so a
  // ref set inside one is already ahead by the time the effects run.
  //
  // Restored synchronously from the draft mirror so a reload shows what was
  // being typed on the first paint rather than after the drafts request lands.
  /**
   * The already-sent message the composer is currently replacing, or null.
   *
   * Holds the anchor rather than the message, because that is all the send
   * needs and it keeps a stale message object from being captured while the
   * transcript refreshes underneath the composer.
   */
  const [editingAnchorId, setEditingAnchorId] = useState<string | null>(null);

  const [inputState, setInputState] = useState<{ scope: string | null; value: string }>(() => {
    if (typeof window === 'undefined') {
      return { scope: null, value: '' };
    }
    const initialScope = selectedSession?.id || currentSessionId
      || (selectedProject ? `project:${selectedProject.projectId}` : null);
    return {
      scope: initialScope,
      value: initialScope ? readDraftText(initialScope) : '',
    };
  });
  const input = inputState.value;
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [commandModalPayload, setCommandModalPayload] = useState<CommandModalPayload | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const textareaLineHeightRef = useRef<number | null>(null);
  const lastAutosizedInputRef = useRef<string | null>(null);
  const handleSubmitRef = useRef<
    ((
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      submitOptions?: SubmitOptions,
    ) => Promise<void>) | null
  >(null);
  const inputValueRef = useRef(input);
  const selectedProjectId = selectedProject?.projectId;
  // Prefer the stable backend-allocated id (selectedSession.id) but fall back
  // to currentSessionId for a just-established session that hasn't been
  // handed back to the parent's `selectedSession` prop yet.
  const sessionKey = selectedSession?.id || currentSessionId || null;
  // The chat scope a draft belongs to: the open session, or the project for a
  // chat that has not been sent yet and so has no session id. Drafts used to be
  // keyed by project alone, so every session in a project shared one draft.
  const draftScope = sessionKey ?? (selectedProjectId ? `project:${selectedProjectId}` : null);
  const draftScopeRef = useRef(draftScope);
  draftScopeRef.current = draftScope;
  // Composition is tracked on `window` in the capture phase rather than on the textarea, so a
  // composition that starts in one field and ends after focus moves still closes cleanly.
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  useEffect(() => {
    const onStart = () => {
      isComposingRef.current = true;
    };
    const onEnd = () => {
      isComposingRef.current = false;
      lastCompositionEndAtRef.current = performance.now();
    };
    // `blur` does not bubble, but a capture-phase listener on `window` still sees it on the way
    // down — otherwise a composition abandoned by clicking away would stay open forever.
    const onBlur = () => {
      isComposingRef.current = false;
    };
    window.addEventListener('compositionstart', onStart, true);
    window.addEventListener('compositionend', onEnd, true);
    window.addEventListener('blur', onBlur, true);
    return () => {
      window.removeEventListener('compositionstart', onStart, true);
      window.removeEventListener('compositionend', onEnd, true);
      window.removeEventListener('blur', onBlur, true);
    };
  }, []);

  const setInput = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    setInputState((previous) => ({
      scope: draftScopeRef.current,
      value: typeof next === 'function' ? next(previous.value) : next,
    }));
  }, []);
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;

  // Recall writes go through the same pair of stores a send reads: the state
  // (for the render) and inputValueRef (so an immediate Enter submits the
  // recalled text, not a stale value).
  const setInputFromHistory = useCallback((value: string) => {
    setInput(value);
    inputValueRef.current = value;
  }, [setInput]);
  const { recordSentMessage, handleHistoryKeyDown } = useInputHistory({
    setInput: setInputFromHistory,
    textareaRef,
    scope: draftScope,
  });

  /**
   * The server-owned queue for the open session. It lives here only so the
   * composer can render it: every change goes through `api.chatQueue`, and a
   * refresh (not local mutation) is what makes the result visible.
   */
  const [queueMessages, setQueueMessages] = useState<ChatQueueMessage[]>([]);
  /** True while a failed or outcome-unknown turn is holding the session's queue. */
  const [queuePaused, setQueuePaused] = useState(false);
  /** Why the queue is paused, shown next to the failed message. */
  const [queuePauseReason, setQueuePauseReason] = useState<string | null>(null);
  /**
   * The server's live-turn signal for "insert now". The client's own
   * `isLoading` goes false while a steered follow-up is still being answered,
   * so the buttons must follow this instead.
   */
  const [queueCanInsert, setQueueCanInsert] = useState(false);
  /** A submit is in flight; the composer disables its actions instead of silently ignoring a second click. */
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** The queued message whose insert request is in flight, so its button can disable. */
  const [insertingMessageId, setInsertingMessageId] = useState<string | null>(null);
  /**
   * The queued message being edited, or null. While set, submitting PATCHes
   * that message instead of sending a turn, so an edit can never turn into a
   * second copy of the text.
   */
  const [editingQueueMessage, setEditingQueueMessage] = useState<ChatQueueMessage | null>(null);
  /** The session `queueMessages` belongs to; stale responses are discarded. */
  const queueSessionRef = useRef<string | null>(sessionKey);
  const queueRefreshSeqRef = useRef(0);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'help':
          setCommandModalPayload({
            kind: 'help',
            data: (data || {}) as HelpCommandData,
          });
          break;

        case 'models':
          setCommandModalPayload({
            kind: 'models',
            data: (data || {}) as ModelCommandData,
          });
          break;

        case 'cost': {
          setCommandModalPayload({
            kind: 'cost',
            data: (data || {}) as CostCommandData,
          });
          break;
        }

        case 'status': {
          setCommandModalPayload({
            kind: 'status',
            data: (data || {}) as StatusCommandData,
          });
          break;
        }

        case 'memory':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `Warning: ${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              type: 'assistant',
              content: `${data.message}\n\nPath: \`${data.path}\``,
              timestamp: Date.now(),
            });
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [onFileOpen, onShowSettings, addMessage],
  );

  const closeCommandModal = useCallback(() => {
    setCommandModalPayload(null);
  }, []);

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        addMessage({
          type: 'assistant',
          content: 'Command execution cancelled',
          timestamp: Date.now(),
        });
        return;
      }
    }

    const commandContent = content || '';
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    // The expanded body is the message itself: it skips slash-command interception.
    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent(), { skipCommandInterception: true });
      }
    }, 0);
  }, [addMessage]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string, options?: { preserveInput?: boolean }) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        // Everything typed after the command name is its argument text, line
        // breaks included (`[\s\S]`, unlike `.`), trimmed as the Claude Code CLI
        // does. `$ARGUMENTS` gets it verbatim; `$1`, `$2`, … get its tokens.
        // The name must open the input and end at whitespace or the end: a pick
        // from the slash menu passes the whole composer, where the name may
        // appear later or inside a longer word ("see /echo2 …" has no arguments).
        const commandMatch = effectiveInput
          .trimStart()
          .match(new RegExp(`^${escapeRegExp(command.name)}(?=\\s|$)([\\s\\S]*)`));
        const rawArgs = commandMatch ? commandMatch[1].trim() : '';
        const args = rawArgs ? rawArgs.split(/\s+/) : [];

        // The `/api/commands/execute` context sends `projectId` now instead of
        // a folder-derived project name; the path is still included verbatim.
        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectId: selectedProject.projectId,
          sessionId: currentSessionId || selectedSession?.id || null,
          provider,
          model: currentProviderModel,
          tokenUsage: tokenBudget,
        };

        const response = await api.commands.execute({
          commandName: command.name,
          commandPath: command.path,
          args,
          rawArgs,
          context,
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          handleBuiltInCommand(result);
          if (!options?.preserveInput) {
            setInput('');
            inputValueRef.current = '';
          }
        } else if (result.type === 'custom') {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        addMessage({
          type: 'assistant',
          content: `Error executing command: ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [
      currentProviderModel,
      currentSessionId,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      selectedSession?.id,
      addMessage,
      tokenBudget,
    ],
  );

  const showCostModal = useCallback(() => {
    executeCommand(
      {
        name: '/cost',
        description: 'Display token usage information',
        namespace: 'builtin',
        metadata: { type: 'builtin' },
      } as SlashCommand,
      '/cost',
      { preserveInput: true },
    );
  }, [executeCommand]);

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    provider,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const resizeTextarea = useCallback((target: HTMLTextAreaElement) => {
    target.style.height = 'auto';
    const nextHeight = Math.max(22, target.scrollHeight);
    target.style.height = `${nextHeight}px`;

    let lineHeight = textareaLineHeightRef.current;
    if (!lineHeight) {
      lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      textareaLineHeightRef.current = Number.isFinite(lineHeight) ? lineHeight : 24;
    }

    const expanded = nextHeight > (textareaLineHeightRef.current || 24) * 2;
    setIsTextareaExpanded((previous) => previous === expanded ? previous : expanded);
    lastAutosizedInputRef.current = target.value;
  }, []);

  const handleAttachmentFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (file.size > MAX_ATTACHMENT_SIZE) {
          const fileName = file.name || 'Unknown file';
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(fileName, 'File too large (max 10MB)');
            return next;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedFiles((previous) => [...previous, ...validFiles].slice(0, MAX_ATTACHMENT_COUNT));
    }
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleAttachmentFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        const imageFiles = files.filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          handleAttachmentFiles(imageFiles);
        }
      }
    },
    [handleAttachmentFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE,
    maxFiles: MAX_ATTACHMENT_COUNT,
    onDrop: handleAttachmentFiles,
    noClick: true,
    noKeyboard: true,
  });

  // Snapshot of everything `chat.send` needs beyond the text itself. Built at
  // send time for immediate sends and at queue time for queued ones, so a
  // queued message keeps the provider settings it was composed under even if
  // it is later dispatched outside this composer (app-level auto-send).
  const buildSendOptions = useCallback((currentInput: string): QueuedSendOptions => {
    const getToolsSettings = () => readUserPreference(
      PROVIDER_PERMISSION_PREFERENCE_KEYS[provider],
      {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false,
      },
    );

    const toolsSettings = getToolsSettings();

    return {
      model: currentProviderModel,
      effort: currentProviderEffort,
      permissionMode: resolvePermissionModeForProvider(provider, permissionMode),
      toolsSettings,
      skipPermissions: toolsSettings?.skipPermissions || false,
      sessionSummary: getNotificationSessionSummary(selectedSession, currentInput),
    };
  }, [
    currentProviderEffort,
    currentProviderModel,
    permissionMode,
    provider,
    resolvePermissionModeForProvider,
    selectedSession,
  ]);

  // Read at send time through a ref: the map changes on every poll, and a
  // submit handler rebuilt that often would re-render the whole composer.
  const processingSessionsRef = useRef(processingSessions);
  useEffect(() => {
    processingSessionsRef.current = processingSessions;
  }, [processingSessions]);

  // The server owns the queue; the composer only reads it. A failed refresh
  // keeps the last snapshot instead of blanking the cards.
  const refreshQueue = useCallback(async (sessionId: string | null): Promise<void> => {
    const sequence = queueRefreshSeqRef.current + 1;
    queueRefreshSeqRef.current = sequence;

    if (!sessionId) {
      setQueueMessages([]);
      setQueuePaused(false);
      setQueuePauseReason(null);
      setQueueCanInsert(false);
      return;
    }

    try {
      const response = await api.chatQueue.list(sessionId);
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { data?: ChatQueueSnapshot };
      if (
        queueRefreshSeqRef.current !== sequence
        || queueSessionRef.current !== sessionId
        || !payload.data
      ) {
        return;
      }
      setQueueMessages(payload.data.messages);
      setQueuePaused(payload.data.paused);
      setQueuePauseReason(payload.data.pauseReason);
      setQueueCanInsert(payload.data.canInsert === true);
    } catch (error) {
      console.error('Failed to load the chat queue:', error);
    }
  }, []);

  /** Clears the composer only after the server confirmed it owns the message. */
  const clearComposerAfterSubmit = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    resetCommandMenuState();
    setAttachedFiles([]);
    setFileErrors(new Map());
    setIsTextareaExpanded(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (draftScopeRef.current) {
      writeDraftText(draftScopeRef.current, '');
    }
  }, [resetCommandMenuState, setInput]);

  /**
   * Appends one message to the session's server queue.
   *
   * The composer text is cleared only after the request succeeds: if the
   * server rejects it, the user's message is still in the box to retry.
   */
  const enqueueMessage = useCallback(async (input: {
    sessionId: string;
    content: string;
    options: QueuedSendOptions;
    attachments: unknown[];
  }): Promise<boolean> => {
    try {
      const response = await api.chatQueue.append({
        sessionId: input.sessionId,
        requestId: createQueueRequestId(),
        content: input.content,
        options: input.options,
        attachments: input.attachments,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(readApiErrorMessage(body, `Failed to queue the message (${response.status})`));
      }

      recordSentMessage(input.content, input.sessionId);
      clearComposerAfterSubmit();
      // Refreshing must not hold the submit lock: a slow list request would
      // otherwise swallow the user's next click.
      if (sessionKeyRef.current === input.sessionId) {
        void refreshQueue(input.sessionId);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to queue the message:', error);
      addMessage({
        type: 'error',
        content: `Failed to queue the message: ${message}`,
        timestamp: new Date(),
      });
      return false;
    }
  }, [addMessage, clearComposerAfterSubmit, recordSentMessage, refreshQueue]);

  /**
   * Submits a message that should steer the running turn.
   *
   * The server stores it first and then inserts it, so a turn that ended while
   * the request was in flight leaves the message queued instead of losing it.
   */
  const steerMessage = useCallback(async (input: {
    sessionId: string;
    content: string;
    options: QueuedSendOptions;
    attachments: unknown[];
  }): Promise<void> => {
    try {
      const response = await api.chatQueue.steer({
        sessionId: input.sessionId,
        requestId: createQueueRequestId(),
        content: input.content,
        options: input.options,
        attachments: input.attachments,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(readApiErrorMessage(body, `Failed to insert the message (${response.status})`));
      }
      const payload = (await response.json().catch(() => null)) as {
        data?: { inserted?: boolean };
      } | null;
      const inserted = payload?.data?.inserted === true;

      recordSentMessage(input.content, input.sessionId);
      clearComposerAfterSubmit();
      if (sessionKeyRef.current === input.sessionId) {
        // Not awaited: the submit lock must not depend on the list request.
        void refreshQueue(input.sessionId);
      }
      if (!inserted) {
        // The server kept the message in the queue because the turn had
        // already ended. Say so, instead of leaving a click with no effect.
        addMessage({
          type: 'assistant',
          content: t('input.queue.insertFallback', {
            defaultValue: 'The current turn had already ended, so the message is kept in the queue and will be sent when the session is free.',
          }),
          timestamp: new Date(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to insert the message:', error);
      addMessage({
        type: 'error',
        content: `Failed to insert the message: ${message}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage, clearComposerAfterSubmit, recordSentMessage, refreshQueue, t]);

  /** Runs one queue mutation, refreshes the cards, and reports refusals inline. */
  const runQueueMutation = useCallback(async (
    request: Promise<Response>,
    failureLabel: string,
  ): Promise<boolean> => {
    try {
      const response = await request;
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(readApiErrorMessage(body, `${failureLabel} (${response.status})`));
      }
      await refreshQueue(sessionKeyRef.current);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`${failureLabel}:`, error);
      addMessage({
        type: 'error',
        content: `${failureLabel}: ${message}`,
        timestamp: new Date(),
      });
      return false;
    }
  }, [addMessage, refreshQueue]);

  const editQueuedMessage = useCallback((message: ChatQueueMessage) => {
    setEditingQueueMessage(message);
    setInput(message.content);
    inputValueRef.current = message.content;
    // Stored attachments stay with the server row; browser files picked here
    // replace them when the edit is submitted.
    setAttachedFiles([]);
    setFileErrors(new Map());
    textareaRef.current?.focus();
  }, [setInput]);

  const cancelQueuedEdit = useCallback(() => {
    if (!editingQueueMessage) {
      return;
    }
    setEditingQueueMessage(null);
    setInput('');
    inputValueRef.current = '';
    setAttachedFiles([]);
    setFileErrors(new Map());
  }, [editingQueueMessage, setInput]);

  const deleteQueuedMessage = useCallback(async (message: ChatQueueMessage) => {
    const removed = await runQueueMutation(
      api.chatQueue.remove(message.id, message.version),
      'Failed to delete the queued message',
    );
    if (removed && editingQueueMessage?.id === message.id) {
      setEditingQueueMessage(null);
      setInput('');
      inputValueRef.current = '';
    }
  }, [editingQueueMessage?.id, runQueueMutation, setInput]);

  const retryQueuedMessage = useCallback((message: ChatQueueMessage) => (
    runQueueMutation(api.chatQueue.retry(message.id), 'Failed to retry the queued message')
  ), [runQueueMutation]);

  /**
   * Steers the turn in flight for one queued message.
   *
   * The server may accept the request but keep the message queued (the turn
   * ended first); that comes back as `inserted:false`, which is a real outcome
   * the user has to see — not a successful click.
   */
  const insertQueuedMessageNow = useCallback(async (message: ChatQueueMessage) => {
    if (insertingMessageId) {
      return;
    }
    setInsertingMessageId(message.id);

    try {
      const response = await api.chatQueue.insert(message.id);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(readApiErrorMessage(
          body,
          `Failed to insert the queued message (${response.status})`,
        ));
      }
      const payload = (await response.json().catch(() => null)) as {
        data?: { inserted?: boolean };
      } | null;
      const inserted = payload?.data?.inserted === true;

      if (sessionKeyRef.current === message.sessionId) {
        void refreshQueue(message.sessionId);
      }
      if (!inserted) {
        addMessage({
          type: 'assistant',
          content: t('input.queue.insertFallback', {
            defaultValue: 'The current turn had already ended, so the message is kept in the queue and will be sent when the session is free.',
          }),
          timestamp: new Date(),
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to insert the queued message:', error);
      addMessage({
        type: 'error',
        content: `${t('input.queue.insertFailed', { defaultValue: 'Failed to insert the queued message' })}: ${reason}`,
        timestamp: new Date(),
      });
    } finally {
      setInsertingMessageId(null);
    }
  }, [addMessage, insertingMessageId, refreshQueue, t]);

  const skipQueuedMessage = useCallback((message: ChatQueueMessage) => (
    runQueueMutation(api.chatQueue.skip(message.id), 'Failed to skip the queued message')
  ), [runQueueMutation]);

  const submitMessage = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      submitOptions?: SubmitOptions,
    ) => {
      event.preventDefault();
      const currentInput = inputValueRef.current;
      const currentAttachments = attachedFiles;
      if ((!currentInput.trim() && currentAttachments.length === 0) || !selectedProject) {
        return;
      }

      // Editing a queued message replaces it. This must never fall through to
      // a normal send, or the text would also start a turn of its own.
      if (editingQueueMessage) {
        let editedAttachments = editingQueueMessage.attachments;
        if (currentAttachments.length > 0) {
          try {
            editedAttachments = await uploadAttachmentFiles(currentAttachments);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Queued file upload failed:', error);
            addMessage({
              type: 'error',
              content: `Failed to upload files: ${message}`,
              timestamp: new Date(),
            });
            return;
          }
        }

        const updated = await runQueueMutation(
          api.chatQueue.edit(editingQueueMessage.id, {
            version: editingQueueMessage.version,
            content: currentInput,
            // Keep the settings the message was composed with.
            options: editingQueueMessage.options,
            attachments: editedAttachments,
          }),
          'Failed to update the queued message',
        );
        if (updated) {
          setEditingQueueMessage(null);
          clearComposerAfterSubmit();
        }
        return;
      }

      // "Insert now": steer the turn in flight. The server writes the message
      // to the queue first and only then inserts it, so a turn that ended in
      // the meantime leaves the message queued rather than losing it.
      const steerSessionId = submitOptions?.insertNow ? sessionKey : null;
      if (steerSessionId) {
        let steerAttachments: unknown[] = [];
        try {
          steerAttachments = await uploadAttachmentFiles(currentAttachments);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Insert attachment upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload files: ${message}`,
            timestamp: new Date(),
          });
          return;
        }

        await steerMessage({
          sessionId: steerSessionId,
          content: currentInput,
          options: buildSendOptions(currentInput),
          attachments: steerAttachments,
        });
        return;
      }

      // A turn is already in flight — or a steered follow-up is still being
      // answered by the live process — so append to the server queue instead
      // of starting a new run (which would supersede that process).
      if (isLoading || queueCanInsert) {
        const queuedSessionId = sessionKey;
        if (!queuedSessionId) {
          return;
        }

        let queuedAttachments: unknown[] = [];
        try {
          queuedAttachments = await uploadAttachmentFiles(currentAttachments);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Queued file upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload files: ${message}`,
            timestamp: new Date(),
          });
          return;
        }

        await enqueueMessage({
          sessionId: queuedSessionId,
          content: currentInput,
          options: buildSendOptions(currentInput),
          attachments: queuedAttachments,
        });
        return;
      }

      // Intercept slash commands only when "/" is the first input character.
      // Also accept exact "help" as a convenience alias for users who expect CLI-style help.
      const commandInput = currentInput.trimEnd();
      const isHelpAlias = commandInput.trim().toLowerCase() === 'help';
      if (!submitOptions?.skipCommandInterception && (commandInput.startsWith('/') || isHelpAlias)) {
        // The name ends at the first whitespace of any kind, so "/cmd" followed
        // by a line break still runs /cmd (the Claude Code CLI splits the same way).
        const firstWhitespace = commandInput.search(/\s/);
        const commandName = isHelpAlias
          ? '/help'
          : firstWhitespace > 0 ? commandInput.slice(0, firstWhitespace) : commandInput;
        const matchedCommand =
          slashCommands.find((cmd: SlashCommand) => cmd.name === commandName) ||
          (commandName === '/help'
            ? ({
                name: '/help',
                description: 'Show help documentation for Claude Code',
                namespace: 'builtin',
                metadata: { type: 'builtin' },
              } as SlashCommand)
            : undefined);
        if (matchedCommand && matchedCommand.type !== 'skill') {
          executeCommand(matchedCommand, isHelpAlias ? '/help' : commandInput);
          recordSentMessage(currentInput);
          setInput('');
          inputValueRef.current = '';
          setAttachedFiles([]);
          setFileErrors(new Map());
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
          return;
        }
      }

      const messageContent = currentInput;

      let uploadedAttachments: unknown[] = [];
      if (uploadedAttachments.length === 0 && currentAttachments.length > 0) {
        try {
          uploadedAttachments = await uploadAttachmentFiles(currentAttachments);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('File upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload files: ${message}`,
            timestamp: new Date(),
          });
          return;
        }
      }

      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const sessionSummary = getNotificationSessionSummary(selectedSession, currentInput);

      // The conversation always has a stable backend-allocated session id
      // BEFORE the first websocket send: brand-new chats allocate one here
      // via the session gateway. There is no client-visible session-id
      // handoff later — this id stays valid for the conversation's lifetime.
      let targetSessionId = selectedSession?.id || currentSessionId || null;
      if (!targetSessionId) {
        let createdSessionName = sessionSummary;
        try {
          const response = await api.providers.createSession({
            provider,
            projectPath: resolvedProjectPath,
            initialMessage: messageContent,
          });
          if (!response.ok) {
            throw new Error(`Failed to create session (${response.status})`);
          }
          const body = await response.json();
          targetSessionId = body?.data?.sessionId || null;
          // A blank server name would leave the session unlabeled, so the local
          // summary stays the fallback unless a real name comes back.
          const returnedSessionName = typeof body?.data?.sessionName === 'string'
            ? body.data.sessionName.trim()
            : '';
          if (returnedSessionName) {
            createdSessionName = returnedSessionName;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Session creation failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to start a new session: ${message}`,
            timestamp: new Date(),
          });
          return;
        }

        if (!targetSessionId) {
          addMessage({
            type: 'error',
            content: 'Failed to start a new session: no session id returned.',
            timestamp: new Date(),
          });
          return;
        }

        onSessionEstablished?.(targetSessionId, {
          provider,
          project: selectedProject,
          summary: createdSessionName,
        });
      }

      // A new turn replaces the CLI process a session's background work runs
      // under: the agents, workflows and commands it still has going would be
      // stopped. The user's message is never the thing to drop, so it joins
      // the server queue and starts when the session is actually free.
      const backgroundActivity = processingSessionsRef.current?.get(targetSessionId);
      if (backgroundActivity?.background) {
        await enqueueMessage({
          sessionId: targetSessionId,
          content: messageContent,
          options: buildSendOptions(messageContent),
          attachments: uploadedAttachments,
        });
        return;
      }

      const attachmentRecords = uploadedAttachments as ChatAttachment[];
      const userMessage: ChatMessage = {
        type: 'user',
        content: currentInput,
        images: attachmentRecords.filter(isImageAttachment),
        files: attachmentRecords.filter((attachment) => !isImageAttachment(attachment)),
        timestamp: new Date(),
        // Tags this echo as the replacement, so the truncation the server
        // broadcasts a moment later cuts the turns being replaced without
        // taking the message the user just sent with them.
        ...(editingAnchorId ? { replacesAnchorId: editingAnchorId } : {}),
      };

      addMessage(userMessage);
      // Mark this request as processing in the per-session activity map (the
      // single source of truth the indicator derives from). The id is always
      // concrete at this point — no pending placeholder exists anymore.
      onSessionProcessing?.(targetSessionId, {
        statusText: null,
        canInterrupt: true,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      // One message shape for every provider. The backend resolves the
      // provider, project path, and provider-native resume id from the
      // session row; `options` only carries composer-level preferences.
      sendMessage({
        // Replacing an already-sent message is its own frame: it changes the
        // shape of the conversation, so it gets validated separately and can
        // report why it was refused.
        type: editingAnchorId ? 'chat.edit-send' : 'chat.send',
        sessionId: targetSessionId,
        ...(editingAnchorId ? { anchorId: editingAnchorId } : {}),
        content: messageContent,
        options: {
          ...buildSendOptions(messageContent),
          attachments: uploadedAttachments,
        },
      });
      setEditingAnchorId(null);

      // Recorded under the (possibly just-allocated) session id, so the first
      // message of a new chat lands in the history of the session the user is
      // navigated to.
      recordSentMessage(currentInput, targetSessionId);
      clearComposerAfterSubmit();
    },
    [
      selectedSession,
      attachedFiles,
      buildSendOptions,
      clearComposerAfterSubmit,
      currentSessionId,
      editingAnchorId,
      editingQueueMessage,
      enqueueMessage,
      executeCommand,
      isLoading,
      onSessionProcessing,
      onSessionEstablished,
      provider,
      queueCanInsert,
      recordSentMessage,
      resetCommandMenuState,
      runQueueMutation,
      scrollToBottom,
      selectedProject,
      sendMessage,
      sessionKey,
      steerMessage,
      addMessage,
      setIsUserScrolledUp,
      slashCommands,
    ],
  );

  // Chat scopes with a submit still awaiting its upload or, for a brand-new
  // chat, its session id. The composer does not change until that returns (the
  // text stays, send stays enabled), so on a slow server the user submits
  // again — and each extra submit of a new chat allocated its own session and
  // sent it the same first message.
  const submittingScopesRef = useRef(new Set<string>());

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      submitOptions?: SubmitOptions,
    ) => {
      const scope = draftScopeRef.current ?? '';
      if (submittingScopesRef.current.has(scope)) {
        // Still cancel the event: an ignored form submit must not reload the page.
        event.preventDefault();
        return;
      }
      submittingScopesRef.current.add(scope);
      // A second click while this request is in flight is ignored; the
      // composer disables its actions so the user can see that it was not.
      setIsSubmitting(true);
      try {
        await submitMessage(event, submitOptions);
      } finally {
        submittingScopesRef.current.delete(scope);
        setIsSubmitting(false);
      }
    },
    [submitMessage],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  /** Composer action: send the typed message into the running turn. */
  const submitInsertNow = useCallback(() => {
    void handleSubmit(createFakeSubmitEvent(), { insertNow: true });
  }, [handleSubmit]);

  // Load the open session's server queue and keep it fresh: the dispatcher
  // claims and sends messages outside this tab, so polling is how the cards
  // learn that a message is in flight, failed, or gone.
  useEffect(() => {
    queueSessionRef.current = sessionKey;
    setEditingQueueMessage(null);
    void refreshQueue(sessionKey);
    if (!sessionKey) {
      return;
    }
    const timer = setInterval(() => void refreshQueue(sessionKey), 5_000);
    return () => clearInterval(timer);
  }, [sessionKey, refreshQueue]);

  // A message that is claimed (or disappears) while being edited can no longer
  // be patched. Drop the edit mode; if the text was untouched, also clear it so
  // submitting again cannot create a second copy of a message already on its
  // way. Text the user changed stays in the composer.
  useEffect(() => {
    if (!editingQueueMessage) {
      return;
    }
    const current = queueMessages.find((message) => message.id === editingQueueMessage.id);
    if (!current || current.status !== 'pending') {
      setEditingQueueMessage(null);
      if (inputValueRef.current === editingQueueMessage.content) {
        setInput('');
        inputValueRef.current = '';
      }
    }
  }, [editingQueueMessage, queueMessages, setInput]);

  // A voice transcript either fills the input (to edit before sending) or, when the
  // user tapped "stop and send", is submitted straight away. Mirror the value into
  // inputValueRef synchronously so handleSubmit reads the new text, not the stale state.
  const handleVoiceTranscript = useCallback((text: string, send?: boolean) => {
    const base = inputValueRef.current.trim();
    const next = base ? `${base} ${text}` : text;
    setInput(next);
    inputValueRef.current = next;
    if (send) handleSubmitRef.current?.(createFakeSubmitEvent());
  }, [setInput]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  // Swap in the open scope's draft, and pick up one that arrives from another
  // device with the hydrated drafts.
  useEffect(() => {
    if (!draftScope) {
      return;
    }

    const restoreDraft = () => {
      const savedInput = readDraftText(draftScope);
      setInputState((previous) => {
        if (previous.scope === draftScope && previous.value === savedInput) {
          return previous;
        }
        inputValueRef.current = savedInput;
        return { scope: draftScope, value: savedInput };
      });
    };

    restoreDraft();
    return subscribeToChatDrafts(restoreDraft);
  }, [draftScope]);

  // Only persist text that was typed for the scope it is about to be written
  // to; see the inputState declaration for why the scope travels with the text.
  useEffect(() => {
    if (!draftScope || inputState.scope !== draftScope) {
      return;
    }
    writeDraftText(draftScope, inputState.value);
  }, [inputState, draftScope]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    if (lastAutosizedInputRef.current === input) {
      return;
    }
    // Re-run for restored drafts and programmatic input changes. User typing is
    // already resized in onInput, so this avoids doing the same forced layout twice.
    resizeTextarea(textareaRef.current);
  }, [input, resizeTextarea]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      if (handleHistoryKeyDown(event)) {
        return;
      }

      if (event.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === 'Enter') {
        const endedJustNow =
          performance.now() - lastCompositionEndAtRef.current < SAFARI_IME_RACE_WINDOW_MS;
        if (event.nativeEvent.isComposing || isComposingRef.current || endedJustNow) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleHistoryKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      resizeTextarea(target);
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);
    },
    [resizeTextarea, setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const targetSessionId = selectedSession?.id || currentSessionId || null;
    if (!targetSessionId) {
      console.warn('Abort requested but no session ID is available.');
      return;
    }

    // The backend resolves the provider from the session row, so no provider
    // field is needed here.
    sendMessage({
      type: 'chat.abort',
      sessionId: targetSessionId,
    });
  }, [canAbortSession, currentSessionId, selectedSession?.id, sendMessage]);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || provider !== 'claude') {
        return { success: false };
      }
      return grantClaudeToolPermission(suggestion.entry);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: 'chat.permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
      });

      setPendingPermissionRequests((previous) =>
        previous.filter((request) => !validIds.includes(request.requestId)),
      );
    },
    [sendMessage, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
    },
    [],
  );

  /** Loads an already-sent message back into the composer to be replaced. */
  const beginEditMessage = useCallback((message: ChatMessage) => {
    if (!message.transcriptAnchorId) return;
    setEditingAnchorId(message.transcriptAnchorId);
    setInput(message.content || '');
    inputValueRef.current = message.content || '';
    textareaRef.current?.focus();
  }, [setInput]);

  const cancelEditMessage = useCallback(() => {
    setEditingAnchorId(null);
    setInput('');
    inputValueRef.current = '';
  }, [setInput]);

  return {
    input,
    setInput,
    editingAnchorId,
    beginEditMessage,
    cancelEditMessage,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    setAttachedFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openAttachmentPicker: open,
    handleSubmit,
    submitInsertNow,
    isSubmitting,
    queueMessages,
    queuePaused,
    queuePauseReason,
    queueCanInsert,
    editingQueueMessage,
    editQueuedMessage,
    cancelQueuedEdit,
    deleteQueuedMessage,
    retryQueuedMessage,
    skipQueuedMessage,
    insertQueuedMessageNow,
    insertingMessageId,
    handleVoiceTranscript,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
  };
}
