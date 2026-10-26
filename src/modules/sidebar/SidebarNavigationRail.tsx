import { Activity, Archive, ArrowUpCircle, Folder, MessageSquare, Settings } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { SidebarSearchMode } from '@/shared/types';
import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type SidebarNavigationRailProps = {
  searchMode: SidebarSearchMode;
  runningSessionsCount: number;
  sidebarVisible: boolean;
  updateAvailable: boolean;
  onSelectMode: (mode: SidebarSearchMode) => void;
  onShowSettings: () => void;
  onShowVersionModal: () => void;
  t: TFunction;
};

/** 供 Sidebar 在 Codex 桌面外观下提供常驻导航，收起项目面板后仍可访问各入口。 */
export default function SidebarNavigationRail({
  searchMode, runningSessionsCount, sidebarVisible, updateAvailable,
  onSelectMode, onShowSettings, onShowVersionModal, t,
}: SidebarNavigationRailProps) {
  const items = [
    { mode: 'projects' as const, icon: Folder, label: t('search.modeProjects') },
    { mode: 'conversations' as const, icon: MessageSquare, label: t('search.modeConversations') },
    { mode: 'running' as const, icon: Activity, label: t('codex.running') },
    { mode: 'archived' as const, icon: Archive, label: t('codex.archived') },
  ];

  return (
    <nav className="codex-navigation-rail" aria-label={t('codex.navigation')}>
      <div className="mb-5 flex h-9 w-9 items-center justify-center text-foreground" aria-hidden="true">
        <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
      </div>
      {items.map(({ mode, icon: Icon, label }) => (
        <Tooltip key={mode} content={label} position="right">
          <button
            type="button"
            aria-label={label}
            aria-pressed={sidebarVisible && searchMode === mode}
            onClick={() => onSelectMode(mode)}
            className={cn('codex-rail-button', sidebarVisible && searchMode === mode && 'is-active')}
          >
            <Icon className="h-5 w-5" strokeWidth={1.7} />
            {mode === 'running' && runningSessionsCount > 0 && (
              <span className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-emerald-600 px-0.5 text-[9px] leading-[14px] text-white">
                {runningSessionsCount > 99 ? '99+' : runningSessionsCount}
              </span>
            )}
          </button>
        </Tooltip>
      ))}
      <div className="flex-1" />
      {updateAvailable && (
        <Tooltip content={t('version.updateAvailable')} position="right">
          <button type="button" className="codex-rail-button" onClick={onShowVersionModal} aria-label={t('version.updateAvailable')}>
            <ArrowUpCircle className="h-5 w-5 text-primary" />
          </button>
        </Tooltip>
      )}
      <Tooltip content={t('actions.settings')} position="right">
        <button type="button" className="codex-rail-button" onClick={onShowSettings} aria-label={t('actions.settings')}>
          <Settings className="h-5 w-5" strokeWidth={1.7} />
        </button>
      </Tooltip>
    </nav>
  );
}
