import { Check, Folder, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/shared/ui';
import type { Project } from '@/shared/types';

type NewChatProjectPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  selectedProject: Project | null;
  isProjectStarred: (projectId: string) => boolean;
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
  t: TFunction;
};

/** Reads the session total the same way the project row does, so both show one number. */
function getProjectSessionCount(project: Project): number {
  return Number(project.sessionMeta?.total ?? project.sessions?.length ?? 0);
}

/**
 * Rendered by Sidebar when the Codex “New chat” button asks which project the
 * new chat should start in, mirroring Codex's project-first new-chat flow.
 */
export default function NewChatProjectPicker({
  open,
  onOpenChange,
  projects,
  selectedProject,
  isProjectStarred,
  onSelectProject,
  onCreateProject,
  t,
}: NewChatProjectPickerProps) {
  // Pinned projects stay at the top of the picker, matching the sidebar order.
  const pinnedProjects = projects.filter((project) => isProjectStarred(project.projectId));
  const otherProjects = projects.filter((project) => !isProjectStarred(project.projectId));

  const renderProject = (project: Project) => {
    const isCurrent = selectedProject?.projectId === project.projectId;
    const sessionCount = getProjectSessionCount(project);

    return (
      <CommandItem
        key={project.projectId}
        // The path is searchable too: two projects can share a display name.
        value={`${project.displayName} ${project.fullPath}`}
        onSelect={() => onSelectProject(project)}
        className="gap-2.5 px-2 py-2"
      >
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
          <Folder className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium leading-4 text-foreground">
              {project.displayName}
            </span>
            {isCurrent && (
              <span className="flex-shrink-0 rounded bg-primary/10 px-1.5 text-[10px] leading-4 text-primary">
                {t('codex.currentProject')}
              </span>
            )}
            {sessionCount > 0 && (
              <span className="flex-shrink-0 rounded bg-muted px-1.5 text-[10px] tabular-nums leading-4 text-muted-foreground">
                {t('codex.sessionCount', { count: sessionCount })}
              </span>
            )}
          </span>
          <span
            className="mt-0.5 block truncate text-[11px] leading-3 text-muted-foreground/70"
            title={project.fullPath}
          >
            {project.fullPath}
          </span>
        </span>
        {isCurrent && <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />}
      </CommandItem>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle>{t('codex.chooseProject')}</DialogTitle>
        <Command label={t('codex.chooseProject')}>
          <div className="flex items-center gap-2 px-4 pb-1 pt-4">
            <Folder className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">{t('codex.chooseProject')}</h2>
          </div>
          <CommandInput placeholder={t('codex.searchProjects')} />
          <CommandList className="max-h-[min(56vh,380px)] px-1.5 pb-1">
            <CommandEmpty>{t('codex.noProjects')}</CommandEmpty>
            {pinnedProjects.length > 0 && (
              <CommandGroup heading={t('codex.pinned')}>
                {pinnedProjects.map(renderProject)}
              </CommandGroup>
            )}
            {otherProjects.length > 0 && (
              <CommandGroup heading={t('search.modeProjects')}>
                {otherProjects.map(renderProject)}
              </CommandGroup>
            )}
          </CommandList>
          <div className="border-t border-border/60 p-1.5">
            <button
              type="button"
              onClick={onCreateProject}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('codex.newProjectAction')}
            </button>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
