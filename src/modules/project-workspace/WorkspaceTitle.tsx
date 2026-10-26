import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';

import { LLMProviderLogo } from '@/shared/ui';
import type { AppTab, Project, ProjectSession } from '@/shared/types';
import { usePlugins } from '@/modules/plugins';
import { copyTextToClipboard, getSessionTitle } from '@/shared/utils';
import { useProviderSessionId } from '@/shared/hooks/useProviderSessionId';
import { useSessionTitleRename } from '@/modules/project-workspace/hooks/useSessionTitleRename';

type WorkspaceTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  /** Increments on every "New Session" click; lets the draft timestamp reset in place. */
  newSessionTrigger: number;
  /** Persists a new title for a session; resolves false when the backend refuses it. */
  onRenameSession: (sessionId: string, summary: string) => Promise<boolean>;
};

/** How long the header shows the copied state after a session id is copied. */
const SESSION_ID_COPIED_FEEDBACK_MS = 1500;

/**
 * Formats a session timestamp (month, day, hour and minute) for the active UI
 * language. Returns an empty string for missing or unparseable values, so the
 * header omits that segment instead of rendering "Invalid Date".
 */
function formatSessionTimestamp(value: string | undefined, language: string): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(language || undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return t('misc.projectFallback');
}

/**
 * Rendered by WorkspaceHeader to label the workspace with the active session or
 * tab name. On the chat tab the session title can be double-clicked to rename
 * the session in place, as a second way in beside the sidebar's rename.
 *
 * The chat tab also shows the identifying context a session title alone cannot:
 * the project's full working directory, when the session was created, and its
 * short session id (copyable), so two similarly named sessions and projects
 * never look alike in the header.
 */
export default function WorkspaceTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  newSessionTrigger,
  onRenameSession,
}: WorkspaceTitleProps) {
  const { t, i18n } = useTranslation();
  const { plugins } = usePlugins();

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;
  const sessionTitle = selectedSession ? getSessionTitle(selectedSession) : '';

  const {
    isEditing: isRenaming,
    draft: renameDraft,
    isSaving: isSavingRename,
    inputRef: renameInputRef,
    startEditing: startRenaming,
    updateDraft: updateRenameDraft,
    cancelEditing: cancelRenaming,
    handleInputKeyDown: handleRenameKeyDown,
  } = useSessionTitleRename({
    sessionId: selectedSession?.id ?? null,
    currentTitle: sessionTitle,
    onRenameSession,
  });

  /**
   * Timestamp of the current new-session draft. A draft has no session row yet,
   * so this is the only creation time the header can show for it. It resets
   * whenever another new session starts or the user switches project.
   */
  const [draftStartedAt, setDraftStartedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    setDraftStartedAt(new Date().toISOString());
  }, [newSessionTrigger, selectedProject.projectId]);

  // Only used for the brief check-mark feedback after copying the session id.
  const [isSessionIdCopied, setIsSessionIdCopied] = useState(false);

  const { providerSessionId } = useProviderSessionId(
    selectedSession?.id ?? null,
    Boolean(selectedSession) && activeTab === 'chat',
  );

  useEffect(() => {
    if (!isSessionIdCopied) return;

    const timer = window.setTimeout(() => setIsSessionIdCopied(false), SESSION_ID_COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [isSessionIdCopied]);

  const sessionFullPath = selectedProject.fullPath || selectedProject.path || '';
  // Split the directory from its last segment so a narrow header can truncate
  // the parents while still showing the folder that actually identifies it.
  const lastPathSeparator = Math.max(sessionFullPath.lastIndexOf('/'), sessionFullPath.lastIndexOf('\\'));
  const pathParents = lastPathSeparator > 0 ? sessionFullPath.slice(0, lastPathSeparator) : '';
  const pathLeaf = lastPathSeparator >= 0 ? sessionFullPath.slice(lastPathSeparator) : sessionFullPath;
  const sessionCreatedAt = selectedSession
    ? String(selectedSession.createdAt ?? selectedSession.created_at ?? '')
    : draftStartedAt;
  const createdLabel = formatSessionTimestamp(sessionCreatedAt, i18n.language);
  // Provider-native ids are what CLI flags and transcripts use, but an
  // app-created session has none until its first run, so the app id stands in.
  const displayedSessionId = selectedSession ? providerSessionId ?? selectedSession.id : '';
  const shortSessionId = displayedSessionId.slice(0, 8);

  const copySessionId = async () => {
    if (!displayedSessionId) return;

    const didCopy = await copyTextToClipboard(displayedSessionId);
    if (didCopy) {
      setIsSessionIdCopied(true);
    }
  };

  /** Path, creation time and session id under a chat title; shared by drafts and existing sessions. */
  const chatContext = (
    <>
      <div className="flex min-w-0 text-[11px] leading-tight text-muted-foreground" title={sessionFullPath}>
        {pathParents && <span className="min-w-0 truncate">{pathParents}</span>}
        <span className="shrink-0">{pathLeaf}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1 text-[11px] leading-tight text-muted-foreground">
        {createdLabel && (
          <>
            <span className="shrink-0">{t('mainContent.sessionCreatedAt', { time: createdLabel })}</span>
            <span aria-hidden="true" className="shrink-0">·</span>
          </>
        )}
        {showChatNewSession ? (
          <span className="truncate" title={t('mainContent.sessionIdPendingHint')}>
            {t('mainContent.sessionId')} {t('mainContent.sessionIdPending')}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void copySessionId()}
            title={`${displayedSessionId} — ${t('mainContent.copySessionId')}`}
            aria-label={t('mainContent.copySessionId')}
            className="inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <span className="shrink-0">{t('mainContent.sessionId')}</span>
            <span className="truncate font-mono">{shortSessionId}</span>
            {isSessionIdCopied
              ? <Check className="h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
              : <Copy className="h-3 w-3 shrink-0" />}
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <LLMProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameDraft}
                onChange={(event) => updateRenameDraft(event.target.value)}
                onKeyDown={handleRenameKeyDown}
                // Clicking anywhere else cancels, as the sidebar's rename does.
                onBlur={cancelRenaming}
                readOnly={isSavingRename}
                aria-busy={isSavingRename}
                aria-label={t('mainContent.renameSessionLabel')}
                // Blur cancels, so a touch keyboard needs a key that commits.
                enterKeyHint="done"
                className="w-full max-w-md rounded border border-border bg-background px-1.5 py-0.5 text-sm font-semibold leading-tight text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <h2
                title={t('mainContent.renameSessionHint', { title: sessionTitle })}
                onDoubleClick={startRenaming}
                className="cursor-text truncate text-sm font-semibold leading-tight text-foreground"
              >
                {sessionTitle}
              </h2>
            )}
            {chatContext}
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            {chatContext}
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        )}
      </div>
    </div>
  );
}
