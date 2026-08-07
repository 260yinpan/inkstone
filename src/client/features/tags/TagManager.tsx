import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react';
import type { Tag } from '@shared/types';
import { LIMITS } from '@shared/constants';
import { compareTagNames, replaceTagInContent, sortTagNames } from '@shared/markdown-utils';
import { ORGANIZER_COLORS } from '@shared/organizer-colors';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import { Drawer, Menu, confirm, type MenuItem } from '../../components/overlay';
import { IconButton } from '../../components/primitives';
import { setOptimisticTagCache, useNotes } from '../../store/notes';
import { useUi } from '../../store/ui';
import { t } from "../../lib/i18n";

export function TagManager({ open, onClose }: {
    open: boolean;
    onClose: () => void;
}) {
    const tags = useNotes((s) => s.tags);
    const toast = useUi((s) => s.toast);
    const openView = useUi((s) => s.openView);
    const [query, setQuery] = useState('');
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [draftName, setDraftName] = useState('');
    const [colorEditingId, setColorEditingId] = useState<string | null>(null);
    const [menuId, setMenuId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const rowRefs = useRef(new Map<string, HTMLElement>());
    const skipRenameBlur = useRef(false);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const list = [...tags].sort((a, b) => compareTagNames(a.name, b.name));
        if (!needle)
            return list;
        return list.filter((tag) => tag.name.toLowerCase().includes(needle));
    }, [tags, query]);

    const startRename = (tag: Tag) => {
        skipRenameBlur.current = false;
        setRenamingId(tag.id);
        setDraftName(tag.name);
        setMenuId(null);
    };

    const commitRename = async (tag: Tag) => {
        const next = draftName.trim().replace(/^#+/, '');
        setRenamingId(null);
        if (!next || next === tag.name || busyId)
            return;
        if (/[\s#]/.test(next) || next.length > LIMITS.tagNameMaxLength) {
            toast({ title: t("tags.invalid_name"), tone: 'danger' });
            return;
        }
        const target = tags.find((candidate) => candidate.id !== tag.id
            && candidate.name.localeCompare(next, undefined, { sensitivity: 'base' }) === 0);
        if (target) {
            const merge = await confirm({
                title: t("tags.merge_confirm_value0_value1", { value0: tag.name, value1: target.name }),
                description: t("tags.merge_description"),
                confirmLabel: t("tags.merge"),
            });
            if (!merge)
                return;
        }
        const destination = target?.name ?? next;
        const before = useNotes.getState();
        const beforeUi = useUi.getState();
        setBusyId(tag.id);
        setOptimisticTagCache((state) => ({
            tags: optimisticRenameTags(state.tags, tag.id, destination),
            notes: rewriteNoteSummaryTags(state.notes, tag.name, destination),
        }));
        if (beforeUi.view === 'tag' && beforeUi.tag === tag.name)
            openView('tag', { tag: destination });
        try {
            const result = await api.tags.patch(tag.id, { name: next });
            await useNotes.getState().pull({ force: true });
            rewriteLoadedNoteContents(tag.name, destination);
            toast({
                title: t("tags.renamed"),
                description: t("tags.updated_note_bodies_value0", {
                    value0: 'renamed' in result ? result.renamed : tag.count,
                }),
                tone: 'success',
            });
        }
        catch (err) {
            setOptimisticTagCache(() => ({ tags: before.tags, notes: before.notes }));
            const ui = useUi.getState();
            if (ui.view === 'tag' && ui.tag === destination)
                openView(beforeUi.view, { folderId: beforeUi.folderId, tag: beforeUi.tag });
            toast({
                title: t("tags.rename_failed"),
                description: err instanceof Error ? err.message : String(err),
                tone: 'danger',
            });
        }
        finally {
            setBusyId(null);
        }
    };

    const deleteTag = async (tag: Tag) => {
        setMenuId(null);
        const ok = await confirm({
            title: t("tags.delete_confirm_value0", { value0: tag.name }),
            description: t("tags.delete_description_value0", { value0: tag.count }),
            tone: 'danger',
            confirmLabel: t("tags.delete"),
        });
        if (!ok)
            return;
        const before = useNotes.getState();
        const beforeUi = useUi.getState();
        setBusyId(tag.id);
        setOptimisticTagCache((state) => ({
            tags: state.tags.filter((candidate) => candidate.id !== tag.id),
            notes: rewriteNoteSummaryTags(state.notes, tag.name, null),
        }));
        if (beforeUi.view === 'tag' && beforeUi.tag === tag.name)
            openView('all');
        try {
            const result = await api.tags.remove(tag.id);
            await useNotes.getState().pull({ force: true });
            rewriteLoadedNoteContents(tag.name, null);
            toast({
                title: t("tags.deleted"),
                description: t("tags.updated_note_bodies_value0", { value0: result.affected }),
                tone: 'success',
            });
        }
        catch (err) {
            setOptimisticTagCache(() => ({ tags: before.tags, notes: before.notes }));
            const ui = useUi.getState();
            if (beforeUi.view === 'tag' && ui.view === 'all')
                openView('tag', { tag: tag.name });
            toast({
                title: t("tags.delete_failed"),
                description: err instanceof Error ? err.message : String(err),
                tone: 'danger',
            });
        }
        finally {
            setBusyId(null);
        }
    };

    const applyColor = async (tag: Tag, color: string | null) => {
        setColorEditingId(null);
        if (tag.color === color || busyId)
            return;
        const before = useNotes.getState().tags;
        setBusyId(tag.id);
        setOptimisticTagCache((state) => ({
            tags: state.tags.map((candidate) => candidate.id === tag.id ? { ...candidate, color } : candidate),
        }));
        try {
            await api.tags.patch(tag.id, { color });
            await useNotes.getState().refreshTags();
        }
        catch (err) {
            setOptimisticTagCache(() => ({ tags: before }));
            toast({
                title: t("tags.color_failed"),
                description: err instanceof Error ? err.message : String(err),
                tone: 'danger',
            });
        }
        finally {
            setBusyId(null);
        }
    };

    return (<Drawer open={open} onClose={onClose} title={t("tags.manage")} width={380}>
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-[var(--border-subtle)] p-2">
          <div className="relative">
            <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-quaternary)]"/>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tags.search_placeholder")} className="w-full rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--bg-inset)] py-1.5 pr-2 pl-8 text-[12.5px] outline-none placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)]"/>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (<div className="px-3 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
              {t("tags.empty_search")}
            </div>) : (<div className="space-y-px">
              {filtered.map((tag) => {
                const menuItems: MenuItem[] = [
                  { id: 'rename', label: t("tags.rename"), icon: <Pencil size={13}/>, onSelect: () => startRename(tag) },
                  { id: 'delete', label: t("tags.delete"), icon: <Trash2 size={13}/>, tone: 'danger', separatorBefore: true, onSelect: () => void deleteTag(tag) },
                ];
                return (<div key={tag.id} ref={(el) => {
                      if (el)
                          rowRefs.current.set(tag.id, el);
                      else
                          rowRefs.current.delete(tag.id);
                  }} aria-busy={busyId === tag.id} className={cn('rounded-[var(--r-md)] transition-colors', menuId === tag.id && 'bg-[var(--bg-hover)]', busyId === tag.id && 'pointer-events-none opacity-60')}>
                  <div className="flex h-9 items-center gap-2 px-1.5">
                    <button type="button" onClick={() => setColorEditingId(colorEditingId === tag.id ? null : tag.id)} aria-label={t("tags.change_color")} className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] transition-transform hover:scale-110">
                      {tag.color ? (<span className="size-3 rounded-full" style={{ background: tag.color }}/>) : (<span className="size-3 rounded-full bg-[var(--text-quaternary)] opacity-40"/>)}
                    </button>
                    {renamingId === tag.id ? (<input value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                              skipRenameBlur.current = true;
                              void commitRename(tag);
                          }
                          else if (event.key === 'Escape') {
                              skipRenameBlur.current = true;
                              setRenamingId(null);
                          }
                      }} onBlur={() => {
                          if (skipRenameBlur.current) {
                              skipRenameBlur.current = false;
                              return;
                          }
                          void commitRename(tag);
                      }} autoFocus className="min-w-0 flex-1 rounded-[var(--r-xs)] border border-[var(--accent)] bg-[var(--bg-surface)] px-1 py-0.5 text-[12.5px] outline-none"/>) : (<button type="button" onClick={() => openView('tag', { tag: tag.name })} onDoubleClick={() => startRename(tag)} className="min-w-0 flex-1 truncate text-left text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <span className="text-[var(--text-primary)]">#</span>{tag.name}
                      </button>)}
                    <span className="shrink-0 text-[11px] tabular text-[var(--text-quaternary)]">
                      {tag.count}
                    </span>
                    <IconButton label={t("common.more_actions")} size="sm" onClick={() => setMenuId(menuId === tag.id ? null : tag.id)}>
                      <MoreHorizontal size={13}/>
                    </IconButton>
                  </div>

                  {colorEditingId === tag.id && (<div className="flex flex-wrap items-center gap-1.5 px-1.5 pb-2">
                      {ORGANIZER_COLORS.map((color) => (<button key={color} type="button" onClick={() => void applyColor(tag, color)} aria-label={color} aria-pressed={tag.color === color} className="size-5 rounded-full border border-[var(--border-default)] transition-transform hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-[var(--accent)] aria-pressed:ring-offset-1" style={{ background: color }}/>))}
                      <button type="button" onClick={() => void applyColor(tag, null)} aria-label={t("tags.clear_color")} className="flex size-5 items-center justify-center rounded-full border border-[var(--border-default)] text-[var(--text-quaternary)] transition-colors hover:text-[var(--text-secondary)]">
                        <X size={12}/>
                      </button>
                    </div>)}

                  {menuId === tag.id && (<Menu anchor={{ current: rowRefs.current.get(tag.id) ?? null }} open onClose={() => setMenuId(null)} items={menuItems}/>)}
                </div>);
            })}
            </div>)}
        </div>

        <div className="shrink-0 border-t border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--text-quaternary)]">
          {t("tags.total_value0", { value0: filtered.length })}
        </div>
      </div>
    </Drawer>);
}

function optimisticRenameTags(tags: Tag[], sourceId: string, destination: string): Tag[] {
    const source = tags.find((tag) => tag.id === sourceId);
    if (!source)
        return tags;
    const target = tags.find((tag) => tag.id !== sourceId
        && tag.name.localeCompare(destination, undefined, { sensitivity: 'base' }) === 0);
    if (!target)
        return tags.map((tag) => tag.id === sourceId ? { ...tag, name: destination } : tag);
    return tags
        .filter((tag) => tag.id !== sourceId)
        .map((tag) => tag.id === target.id ? { ...tag, count: Math.max(tag.count, source.count) } : tag);
}

function rewriteNoteSummaryTags(
    notes: Record<string, import('@shared/types').NoteSummary>,
    from: string,
    to: string | null,
) {
    const next = { ...notes };
    for (const [id, note] of Object.entries(notes)) {
        if (!note.tags.includes(from))
            continue;
        const names = note.tags.flatMap((name) => name === from ? (to ? [to] : []) : [name]);
        const unique = new Map(names.map((name) => [name.normalize('NFKC').toLocaleLowerCase(), name]));
        next[id] = { ...note, tags: sortTagNames(unique.values()) };
    }
    return next;
}

function rewriteLoadedNoteContents(from: string, to: string | null) {
    const state = useNotes.getState();
    for (const [id, content] of Object.entries(state.contents)) {
        const rewritten = replaceTagInContent(content, from, to);
        if (rewritten !== content)
            state.editContent(id, rewritten);
    }
}
