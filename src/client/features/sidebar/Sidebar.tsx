import { useMemo, useRef, useState } from 'react';
import { Archive, ChevronRight, Clock, FilePlus2, FileText, FolderClosed, FolderOpen, FolderPlus, Hash, Inbox, LogOut, Moon, MoreHorizontal, PanelLeft, PanelLeftClose, Settings, Star, Sun, Trash2, Waypoints, } from 'lucide-react';
import type { ViewKind } from '@shared/types';
import { compareTagNames } from '@shared/markdown-utils';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import { Avatar, IconButton, Logo, SectionLabel } from '../../components/primitives';
import { Menu, Tooltip, confirm, useContextMenu, type MenuItem } from '../../components/overlay';
import { switchThemeWithTransition, useUi } from '../../store/ui';
import { useSession } from '../../store/session';
import { useFolderTree, useNavigationCounts, useNotes, type FolderNode } from '../../store/notes';
import { t } from "../../lib/i18n";
export function Sidebar({ collapsed = false, onCollapse, }: {
    collapsed?: boolean;
    onCollapse?: () => void;
}) {
    const view = useUi((s) => s.view);
    const openView = useUi((s) => s.openView);
    const counts = useNavigationCounts();
    if (collapsed)
        return <SidebarRail onExpand={onCollapse}/>;
    return (<aside className="flex h-full min-h-0 flex-col bg-[var(--bg-sunken)]">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <div className="flex min-w-0 items-center gap-[9px] select-none">
          <Logo size={24}/>
          <span className="min-w-0 truncate font-serif text-[15.5px] font-semibold tracking-[0.02em] text-[var(--text-primary)]">
            {t("common.product_name")}
          </span>
        </div>
        {onCollapse && (<Tooltip label={t("sidebar.collapse_navigation")}>
            <IconButton label={t("sidebar.collapse_navigation")} size="sm" onClick={onCollapse}>
              <PanelLeftClose size={15}/>
            </IconButton>
          </Tooltip>)}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-4">
        <div className="space-y-px">
          <ViewItem icon={<FileText size={14}/>} label={t("navigation.all_notes")} view="all" count={counts.all} active={view === 'all'} onSelect={openView}/>
          <ViewItem icon={<Clock size={14}/>} label={t("navigation.recently_edited")} view="recent" active={view === 'recent'} onSelect={openView}/>
          <ViewItem icon={<Star size={14}/>} label={t("navigation.favorites")} view="starred" count={counts.starred} active={view === 'starred'} onSelect={openView}/>
          <ViewItem icon={<Inbox size={14}/>} label={t("navigation.unfiled")} view="unfiled" count={counts.unfiled} active={view === 'unfiled'} onSelect={openView}/>
        </div>

        <FolderSection />
        <TagSection />
      </div>

      <div className="shrink-0 space-y-px border-t border-[var(--border-subtle)] px-2 py-2">
        <ViewItem icon={<Archive size={14}/>} label={t("navigation.archive")} view="archived" count={counts.archived} active={view === 'archived'} onSelect={openView}/>
        <ViewItem icon={<Trash2 size={14}/>} label={t("navigation.trash")} view="trash" count={counts.trash} active={view === 'trash'} onSelect={openView}/>
      </div>

      <div className="shrink-0 border-t border-[var(--border-subtle)] p-2">
        <SidebarAccount />
      </div>
    </aside>);
}
function SidebarRail({ onExpand }: {
    onExpand?: () => void;
}) {
    const view = useUi((s) => s.view);
    const openView = useUi((s) => s.openView);
    const createNote = useNotes((s) => s.createNote);
    return (<aside className="flex h-full min-h-0 flex-col items-center bg-[var(--bg-sunken)]">
      <div className="flex h-11 w-full shrink-0 items-center justify-center border-b border-[var(--border-subtle)]">
        <Tooltip label={t("sidebar.expand_navigation")} side="right">
          <IconButton label={t("sidebar.expand_navigation")} onClick={onExpand}>
            <PanelLeft size={16}/>
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex w-full flex-col items-center gap-1 py-2">
        <RailButton label={t("navigation.all_notes")} active={view === 'all'} icon={<FileText size={16}/>} onClick={() => openView('all')}/>
        <RailButton label={t("navigation.favorites")} active={view === 'starred'} icon={<Star size={16}/>} onClick={() => openView('starred')}/>
        <RailButton label={t("navigation.trash")} active={view === 'trash'} icon={<Trash2 size={16}/>} onClick={() => openView('trash')}/>
        <div className="my-1 h-px w-6 bg-[var(--border-subtle)]"/>
        <RailButton label={t("common.new_note")} combo="mod+n" accent icon={<FilePlus2 size={16}/>} onClick={() => void createNote()}/>
      </div>

      <span className="flex-1"/>

      <div className="flex w-full shrink-0 justify-center border-t border-[var(--border-subtle)] py-2">
        <SidebarAccount rail/>
      </div>
    </aside>);
}
function RailButton({ label, combo, icon, active, accent, onClick, }: {
    label: string;
    combo?: string;
    icon: React.ReactNode;
    active?: boolean;
    accent?: boolean;
    onClick: () => void;
}) {
    return (<Tooltip label={label} combo={combo} side="right">
      <IconButton label={label} active={active} onClick={onClick} className={accent ? 'text-[var(--accent)]' : undefined}>
        {icon}
      </IconButton>
    </Tooltip>);
}
function SidebarAccount({ rail = false }: {
    rail?: boolean;
}) {
    const user = useSession((s) => s.user);
    const theme = useSession((s) => s.settings.appearance.theme);
    const updateSettings = useSession((s) => s.updateSettings);
    const logout = useSession((s) => s.logout);
    const openPanel = useUi((s) => s.openPanel);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    if (!user)
        return null;
    const isDark = theme === 'dark' ||
        (theme === 'system' && document.documentElement.dataset.theme === 'dark');
    const displayName = user.name || user.username;
    const items: MenuItem[] = [
        {
            id: 'settings',
            label: t("common.settings"),
            icon: <Settings size={13}/>,
            combo: 'mod+,',
            onSelect: () => openPanel('settings'),
        },
        {
            id: 'graph',
            label: t("common.graph"),
            icon: <Waypoints size={13}/>,
            combo: 'mod+shift+g',
            onSelect: () => openPanel('graph'),
        },
        {
            id: 'theme',
            label: isDark ? t("sidebar.switch_to_light") : t("sidebar.switch_to_dark"),
            icon: isDark ? <Sun size={13}/> : <Moon size={13}/>,
            separatorBefore: true,
            onSelect: () => {
                const rect = buttonRef.current?.getBoundingClientRect();
                const next = isDark ? 'light' : 'dark';
                switchThemeWithTransition(next, rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined, () => updateSettings({ appearance: { theme: next } }));
            },
        },
        {
            id: 'logout',
            label: t("sidebar.log_out"),
            icon: <LogOut size={13}/>,
            tone: 'danger',
            separatorBefore: true,
            onSelect: () => void logout(),
        },
    ];
    return (<>
      {rail ? (<Tooltip label={`${t("sidebar.account_and_settings")} · ${displayName}`} side="right">
          <button ref={buttonRef} type="button" onClick={() => setMenuOpen(true)} aria-label={t("sidebar.account_and_settings")} className="rounded-full transition-transform duration-[var(--dur-fast)] hover:scale-105 active:scale-95">
            <Avatar src={user.avatarUrl} name={displayName} size={28}/>
          </button>
        </Tooltip>) : (<button ref={buttonRef} type="button" onClick={() => setMenuOpen(true)} aria-label={t("sidebar.account_and_settings")} className="group flex h-11 w-full items-center gap-2.5 rounded-[var(--r-md)] px-2 text-left transition-colors hover:bg-[var(--bg-hover)]">
          <Avatar src={user.avatarUrl} name={displayName} size={28}/>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)]">
              {displayName}
            </span>
            <span className="block truncate text-[10.5px] text-[var(--text-quaternary)]">
              @{user.username}
            </span>
          </span>
          <span className="shrink-0 text-[10.5px] text-[var(--text-quaternary)] group-hover:text-[var(--text-tertiary)]">
            {user.role === 'owner' ? t("common.owner") : t("sidebar.member")}
          </span>
        </button>)}

      <Menu anchor={buttonRef} open={menuOpen} onClose={() => setMenuOpen(false)} items={items} width={252}/>
    </>);
}
function ViewItem({ icon, label, view, count, active, onSelect, }: {
    icon: React.ReactNode;
    label: string;
    view: ViewKind;
    count?: number;
    active: boolean;
    onSelect: (view: ViewKind) => void;
}) {
    const [dropping, setDropping] = useState(false);
    const patchNote = useNotes((s) => s.patchNote);
    const acceptsDrop = view === 'unfiled' || view === 'starred' || view === 'archived' || view === 'trash';
    const deleteNote = useNotes((s) => s.deleteNote);
    return (<button type="button" aria-current={active ? 'page' : undefined} onClick={() => onSelect(view)} onDragOver={(e) => {
            if (!acceptsDrop || !e.dataTransfer.types.includes('application/x-inkstone-note'))
                return;
            e.preventDefault();
            setDropping(true);
        }} onDragLeave={(e) => {
            if (leftDropTarget(e))
                setDropping(false);
        }} onDrop={(e) => {
            setDropping(false);
            const id = e.dataTransfer.getData('application/x-inkstone-note');
            if (!id)
                return;
            e.preventDefault();
            if (view === 'unfiled')
                void patchNote(id, { folderId: null });
            else if (view === 'starred')
                void patchNote(id, { isStarred: true });
            else if (view === 'archived')
                void patchNote(id, { isArchived: true });
            else if (view === 'trash')
                void deleteNote(id);
        }} className={cn('group relative flex h-10 w-full items-center gap-2.5 rounded-[var(--r-md)] px-2 text-left md:h-[30px]', 'transition-colors duration-[var(--dur-fast)]', active
            ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]', dropping && 'ring-1 ring-[var(--accent)]')}>
      <span className={cn('shrink-0', active ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]')}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{label}</span>
      {count != null && count > 0 && (<span className="shrink-0 text-[11px] tabular text-[var(--text-quaternary)]">{count}</span>)}
    </button>);
}
function FolderSection() {
    const tree = useFolderTree();
    const refreshFolders = useNotes((s) => s.refreshFolders);
    const expandFolder = useUi((s) => s.expandFolder);
    const openView = useUi((s) => s.openView);
    const toast = useUi((s) => s.toast);
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const create = async (parentId: string | null) => {
        if (creatingRef.current)
            return;
        creatingRef.current = true;
        setCreating(true);
        const startingUi = useUi.getState();
        const startingNavigation = {
            view: startingUi.view,
            folderId: startingUi.folderId,
            tag: startingUi.tag,
            activeNoteId: startingUi.activeNoteId,
        };
        try {
            const folder = await api.folders.create({ parentId });
            await refreshFolders();
            const currentUi = useUi.getState();
            if (currentUi.view === startingNavigation.view &&
                currentUi.folderId === startingNavigation.folderId &&
                currentUi.tag === startingNavigation.tag &&
                currentUi.activeNoteId === startingNavigation.activeNoteId) {
                if (parentId)
                    expandFolder(parentId);
                openView('folder', { folderId: folder.id });
                setRenamingId(folder.id);
            }
        }
        catch (err) {
            toast({ title: t("sidebar.failed_to_create_folder"), description: err instanceof Error ? err.message : String(err), tone: 'danger' });
        }
        finally {
            creatingRef.current = false;
            setCreating(false);
        }
    };
    return (<section className="mt-4">
      <div className="group/head flex items-center justify-between pr-1">
        <SectionLabel>{t("navigation.folder")}</SectionLabel>
        <Tooltip label={t("common.new_folder")}>
          <IconButton label={t("common.new_folder")} size="sm" disabled={creating} onClick={() => void create(null)} className="opacity-100 transition-opacity md:opacity-0 md:group-hover/head:opacity-100 md:focus-visible:opacity-100">
            <FolderPlus size={13}/>
          </IconButton>
        </Tooltip>
      </div>

      {tree.length === 0 ? (<button type="button" disabled={creating} onClick={() => void create(null)} className="mt-0.5 flex h-10 w-full items-center gap-2 rounded-[var(--r-md)] px-2 text-[12px] text-[var(--text-quaternary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] disabled:pointer-events-none disabled:opacity-45 md:h-[30px]">
          <FolderPlus size={13}/>{t("sidebar.create_first_folder")}</button>) : (<div className="mt-0.5 space-y-px">
          {tree.map((node) => (<FolderRow key={node.id} node={node} onCreateChild={create} renamingId={renamingId} onStartRename={setRenamingId} onFinishRename={() => setRenamingId(null)}/>))}
        </div>)}
    </section>);
}
function FolderRow({ node, onCreateChild, renamingId, onStartRename, onFinishRename, }: {
    node: FolderNode;
    onCreateChild: (parentId: string | null) => void;
    renamingId: string | null;
    onStartRename: (id: string) => void;
    onFinishRename: () => void;
}) {
    const view = useUi((s) => s.view);
    const activeFolderId = useUi((s) => s.folderId);
    const expanded = useUi((s) => s.expandedFolders.includes(node.id));
    const toggleFolder = useUi((s) => s.toggleFolder);
    const openView = useUi((s) => s.openView);
    const refreshFolders = useNotes((s) => s.refreshFolders);
    const patchNote = useNotes((s) => s.patchNote);
    const toast = useUi((s) => s.toast);
    const [dropState, setDropState] = useState<'none' | 'inside'>('none');
    const menu = useContextMenu();
    const buttonRef = useRef<HTMLDivElement>(null);
    const removingRef = useRef(false);
    const renamingRef = useRef(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const active = view === 'folder' && activeFolderId === node.id;
    const hasChildren = node.children.length > 0;
    const renaming = renamingId === node.id;
    const rename = async (name: string) => {
        const trimmed = name.trim();
        if (!trimmed || trimmed === node.name) {
            onFinishRename();
            return;
        }
        if (renamingRef.current)
            return;
        renamingRef.current = true;
        onFinishRename();
        try {
            await api.folders.patch(node.id, { name: trimmed });
            await refreshFolders();
        }
        catch (err) {
            toast({ title: t("sidebar.rename_failed"), description: err instanceof Error ? err.message : String(err), tone: 'danger' });
        }
        finally {
            renamingRef.current = false;
        }
    };
    const remove = async () => {
        if (removingRef.current)
            return;
        removingRef.current = true;
        try {
            const hasContent = node.totalNotes > 0 || hasChildren;
            const ok = await confirm({
                title: t("sidebar.delete_folder_value0", { value0: node.name }),
                description: hasContent
                    ? t("sidebar.the_value0_notes_inside_move_up_one_level_and_are_not_deleted", { value0: node.totalNotes }) : t("sidebar.this_folder_is_empty"),
                confirmLabel: t("common.delete"),
                tone: 'danger',
            });
            if (!ok)
                return;
            await api.folders.remove(node.id, 'move-up');
            await refreshFolders();
            const currentUi = useUi.getState();
            if (currentUi.view === 'folder' && currentUi.folderId === node.id)
                openView('all');
        }
        catch (err) {
            toast({ title: t("common.delete_failed"), description: err instanceof Error ? err.message : String(err), tone: 'danger' });
        }
        finally {
            removingRef.current = false;
        }
    };
    const menuItems: MenuItem[] = [
        { id: 'rename', label: t("sidebar.rename"), onSelect: () => onStartRename(node.id) },
        { id: 'new-note', label: t("sidebar.create_new_note_here"), icon: <FilePlus2 size={13}/>, onSelect: () => void useNotes.getState().createNote({ folderId: node.id }) },
        { id: 'new-child', label: t("sidebar.new_subfolder"), icon: <FolderPlus size={13}/>, onSelect: () => onCreateChild(node.id) },
        { id: 'delete', label: t("sidebar.delete_folder"), tone: 'danger', separatorBefore: true, onSelect: () => void remove() },
    ];
    return (<div>
      <div ref={buttonRef} onContextMenu={(event) => {
            setMenuOpen(false);
            menu.onContextMenu(event);
        }} onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-inkstone-note') &&
                !e.dataTransfer.types.includes('application/x-inkstone-folder'))
                return;
            e.preventDefault();
            e.stopPropagation();
            setDropState('inside');
        }} onDragLeave={(e) => {
            if (leftDropTarget(e))
                setDropState('none');
        }} onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropState('none');
            const noteId = e.dataTransfer.getData('application/x-inkstone-note');
            if (noteId) {
                void patchNote(noteId, { folderId: node.id });
                return;
            }
            const folderId = e.dataTransfer.getData('application/x-inkstone-folder');
            if (folderId && folderId !== node.id) {
                void api.folders
                    .patch(folderId, { parentId: node.id })
                    .then(refreshFolders)
                    .catch((err) => toast({ title: t("sidebar.move_failed"), description: err instanceof Error ? err.message : String(err), tone: 'danger' }));
            }
        }} draggable={!renaming} onDragStart={(e) => {
            e.dataTransfer.setData('application/x-inkstone-folder', node.id);
            e.dataTransfer.effectAllowed = 'move';
        }} className={cn('group relative flex h-10 items-center gap-1 rounded-[var(--r-md)] pr-1 md:h-[30px]', 'transition-colors duration-[var(--dur-fast)]', active
            ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]', dropState === 'inside' && 'ring-1 ring-[var(--accent)]')} style={{ paddingLeft: 6 + node.depth * 13 }}>
        <Tooltip label={expanded ? t("sidebar.collapse") : t("sidebar.expand")} side="right">
          <button type="button" disabled={!hasChildren} aria-hidden={!hasChildren || undefined} tabIndex={hasChildren ? undefined : -1} onClick={(e) => {
                e.stopPropagation();
                toggleFolder(node.id);
            }} aria-label={expanded ? t("sidebar.collapse") : t("sidebar.expand")} className={cn('flex size-8 shrink-0 items-center justify-center rounded text-[var(--text-quaternary)] md:size-4', 'transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]', expanded && 'rotate-90', !hasChildren && 'invisible')}>
            <ChevronRight size={12}/>
          </button>
        </Tooltip>

        <span className={cn('shrink-0', active ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]')}>
          {node.icon ? (<span className="text-[13px] leading-none">{node.icon}</span>) : expanded && hasChildren ? (<FolderOpen size={14}/>) : (<FolderClosed size={14}/>)}
        </span>

        {renaming ? (<input aria-label={t("sidebar.rename")} autoFocus defaultValue={node.name} onBlur={(e) => void rename(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Enter')
                    void rename(e.currentTarget.value);
                if (e.key === 'Escape') {
                    e.currentTarget.value = node.name;
                    onFinishRename();
                }
                e.stopPropagation();
            }} className="min-w-0 flex-1 rounded-[var(--r-xs)] border border-[var(--accent)] bg-[var(--bg-surface)] px-1 py-px text-[12.5px] outline-none"/>) : (<button type="button" aria-current={active ? 'page' : undefined} onClick={() => openView('folder', { folderId: node.id })} onDoubleClick={() => onStartRename(node.id)} className="min-w-0 flex-1 truncate py-1 text-left text-[12.5px] font-medium">
            {node.name}
          </button>)}

        {!renaming && (<>
            <span className="shrink-0 text-[11px] tabular text-[var(--text-quaternary)] transition-opacity group-hover:opacity-0">
              {node.totalNotes > 0 ? node.totalNotes : ''}
            </span>
            <Tooltip label={t("common.more_actions")} side="left">
              <IconButton label={t("common.more_actions")} size="sm" onClick={(e) => {
                    e.stopPropagation();
                    menu.close();
                    setMenuOpen(true);
                }} className="absolute right-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100">
                <MoreHorizontal size={13}/>
              </IconButton>
            </Tooltip>
          </>)}
      </div>

      {expanded && hasChildren && (<div className="space-y-px">
          {node.children.map((child) => (<FolderRow key={child.id} node={child} onCreateChild={onCreateChild} renamingId={renamingId} onStartRename={onStartRename} onFinishRename={onFinishRename}/>))}
        </div>)}

      <Menu anchor={buttonRef} open={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems}/>
      {menu.point && (<Menu anchor={menu.point} open onClose={menu.close} items={menuItems}/>)}
    </div>);
}
function TagSection() {
    const tags = useNotes((s) => s.tags);
    const view = useUi((s) => s.view);
    const activeTag = useUi((s) => s.tag);
    const openView = useUi((s) => s.openView);
    const [expanded, setExpanded] = useState(false);
    const usedTags = useMemo(() => [...tags]
            .filter((t) => t.count > 0)
            .sort((a, b) => b.count - a.count || compareTagNames(a.name, b.name)), [tags]);
    const visible = expanded ? usedTags : usedTags.slice(0, 8);
    if (!usedTags.length)
        return null;
    return (<section className="mt-4">
      <SectionLabel>{t("navigation.tag")}</SectionLabel>
      <div className="mt-0.5 space-y-px">
        {visible.map((tag) => {
            const active = view === 'tag' && activeTag === tag.name;
            return (<button key={tag.id} type="button" aria-current={active ? 'page' : undefined} onClick={() => openView('tag', { tag: tag.name })} className={cn('flex h-10 w-full items-center gap-2 rounded-[var(--r-md)] px-2 text-left md:h-[28px]', 'transition-colors duration-[var(--dur-fast)]', active
                    ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>
              <Hash size={13} className="shrink-0" style={{ color: tag.color ?? (active ? 'var(--accent)' : 'var(--text-quaternary)') }}/>
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{tag.name}</span>
              <span className="shrink-0 text-[11px] tabular text-[var(--text-quaternary)]">
                {tag.count}
              </span>
            </button>);
        })}

        {usedTags.length > 8 && (<button type="button" onClick={() => setExpanded((v) => !v)} className="h-10 w-full rounded-[var(--r-md)] px-2 text-left text-[11.5px] text-[var(--text-quaternary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] md:h-[26px]">
            {expanded ? t("common.collapse") : t("sidebar.show_all_value0_tags", { value0: usedTags.length })}
          </button>)}
      </div>
    </section>);
}
function leftDropTarget(event: React.DragEvent<HTMLElement>): boolean {
    const next = event.relatedTarget;
    return !(next instanceof Node) || !event.currentTarget.contains(next);
}
