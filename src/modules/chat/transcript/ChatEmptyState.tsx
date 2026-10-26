import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Folder, MessageSquare } from 'lucide-react';

import { NextTaskBanner } from '@/modules/task-master';
import { useOptionalAppearanceTheme } from '@/shared/context/ThemeContext';
import type { Project, ProjectSession } from '@/shared/types';
import { copyTextToClipboard } from '@/shared/utils';

/** How long the directory row shows its copied state after a successful copy. */
const DIRECTORY_COPIED_FEEDBACK_MS = 1500;

type ChatEmptyStateProps = {
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: Dispatch<SetStateAction<string>>;
};

type ProjectDirectoryRowProps = {
  path: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
};

/** One fact row of the new-session card: a labelled directory with a copy action. */
function ProjectDirectoryRow({ path, label, copyLabel, copiedLabel }: ProjectDirectoryRowProps) {
  // Only used for the brief check-mark feedback after copying the path.
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) return;

    const timer = window.setTimeout(() => setIsCopied(false), DIRECTORY_COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [isCopied]);

  const copyPath = async () => {
    if (await copyTextToClipboard(path)) {
      setIsCopied(true);
    }
  };

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Folder className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 break-all font-mono text-xs leading-relaxed text-foreground">{path}</div>
      </div>
      <button
        type="button"
        onClick={() => void copyPath()}
        title={isCopied ? copiedLabel : copyLabel}
        aria-label={copyLabel}
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {isCopied
          ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/**
 * Rendered by chat's ChatMessagesPane when the transcript has no messages.
 *
 * A brand-new session shows which project and directory the first turn will run
 * in — the composer owns the provider and model controls, so this card carries
 * identity instead of duplicating them. An existing empty session keeps the
 * "continue your conversation" prompt, plus the next-task banner when
 * TaskMaster is available.
 */
export default function ChatEmptyState({
  selectedProject,
  selectedSession,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: ChatEmptyStateProps) {
  const { t } = useTranslation('chat');
  const isCodexTheme = useOptionalAppearanceTheme() === 'codex';

  if (!selectedSession) {
    const projectPath = selectedProject.fullPath || selectedProject.path || '';
    const projectName = selectedProject.displayName || projectPath;
    const sessionCount = selectedProject.sessionMeta?.total ?? selectedProject.sessions?.length ?? 0;

    return (
      <div data-theme-surface="chat-welcome" className="flex h-full w-full items-center justify-center px-4">
        <div className="w-full max-w-2xl">
          <div className="text-center">
            {isCodexTheme && (
              <div className="mb-5 flex justify-center">
                <MessageSquare className="h-11 w-11 text-muted-foreground/40" strokeWidth={1.4} aria-hidden="true" />
              </div>
            )}
            <h2
              title={projectName}
              className={
                isCodexTheme
                  ? 'break-words text-2xl font-medium tracking-tight text-foreground sm:text-3xl'
                  : 'truncate text-xl font-semibold tracking-tight text-foreground'
              }
            >
              {isCodexTheme
                ? t('emptyState.codexGreeting', {
                    project: projectName,
                    defaultValue: 'What should we build in {{project}}?',
                  })
                : projectName}
            </h2>
            {!isCodexTheme && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t('emptyState.newSessionHint')}
              </p>
            )}
          </div>

          <div data-theme-surface="welcome-details" className="mt-6 overflow-hidden rounded-xl border border-border/60 bg-muted/20">
            <ProjectDirectoryRow
              path={projectPath}
              label={t('emptyState.projectDirectory')}
              copyLabel={t('emptyState.copyDirectory')}
              copiedLabel={t('emptyState.directoryCopied')}
            />
            <div className="flex items-center gap-3 border-t border-border/60 px-4 py-3">
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t('emptyState.sessionCount')}
              </span>
              <span className="ml-auto text-xs font-medium text-foreground">{sessionCount}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const nextTaskPrompt = t('tasks.nextTaskPrompt', {
    defaultValue: 'Start the next task',
  });

  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-[34.25rem] px-6 text-center">
        <p className="mb-1.5 text-lg font-semibold text-foreground">
          {t('session.continue.title')}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('session.continue.description')}
        </p>

        {tasksEnabled && isTaskMasterInstalled && (
          <div className="mt-5">
            <NextTaskBanner
              onStartTask={() => setInput(nextTaskPrompt)}
              onShowAllTasks={onShowAllTasks}
            />
          </div>
        )}
      </div>
    </div>
  );
}
