import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react';
import type { Tag } from '@shared/types';
import { LIMITS } from '@shared/constants';
import { compareTagNames } from '@shared/markdown-utils';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import { Drawer, Menu, confirm, type MenuItem } from '../../components/overlay';
import { IconButton } from '../../components/primitives';
import { useNotes } from '../../store/notes';
import { useUi } from '../../store/ui';
import { t } from "../../lib/i18n";

const TAG_PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#14b8a6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#64748b',
] as const;

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
    const rowRefs = useRef(new Map<string, HTMLElement>());

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const list = [...tags].sort((a, b) => compareTagNames(a.name, b.name));
        if (!needle)
            return list;
        return list.filter((tag) => tag.name.toLowerCase().includes(needle));
    }, [tags, query]);

    const startRename = (tag: Tag) => {
        setRenamingId(tag.id);
        setDraftName(tag.name);
        setMenuId(null);
    };

    const commitRename = async (tag: Tag) => {
        const next = draftName.trim().replace(/^#+/, '');
        setRenamingId(null);
        if (!next || next === tag.name)
            return;
        if (/[\s#]/.test(next) || next.length > LIMITS.tagNameMaxLength) {
            toast({ title: t("tags.invalid_name"), tone: 'danger' });
            return;
        }
        try {
            await api.tags.patch(tag.id, { name: next });
            toast({ title: t("tags.renamed"), tone: 'success' });
            await useNotes.getState().pull();
        }
        catch (err) {
            toast({
                title: t("tags.rename_failed"),
                description: err instanceof Error ? err.message : String(err),
                tone: 'danger',
            });
        }
    };

    const deleteTag = async (tag: Tag) => {
        setMenuId(null);
        const ok = await confirm({
            title: t("tags.delete_confirm_value0", { value0: tag.name }),
            tone: 'danger',
            confirmLabel: t("tags.delete"),
        });
        if (!ok)
            return;
        try {
            await api.tags.remove(tag.id);
            toast({ title: t("tags.deleted"), tone: 'success' });
            await useNotes.getState().pull();
        }
        catch (err) {
            toast({
                title: t("tags.delete_failed"),
                description: err instanceof Error ? err.message : String(err),
                tone: 'danger',
            });
        }
    };

    const applyColor = async (tag: Tag, color: string | null) => {
        setColorEditingId(null);
        if (tag.color === color)
            return;
        try {
            await api.tags.patch(tag.id, { color });
            await useNotes.getState().pull();
        }
        catch (err) {
            toast({
                title: t("tags.color_failed"),
                description: err instanceof Error ? err.message : String(err),
                tone: 'danger',
            });
        }
    };

    return (<Drawer open={open} onClose={onClose} title={t("tags.manage")} width={380}>
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-[var(--border-subtle)] p-2">
          <div className="relative">
            <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-quaternary)]"/>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tags.search_placeholder")} className="w-full rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--bg-input)] py-1.5 pr-2 pl-8 text-[12.5px] outline-none placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)]"/>
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
                  }} className={cn('rounded-[var(--r-md)] transition-colors', menuId === tag.id && 'bg-[var(--bg-hover)]')}>
                  <div className="flex h-9 items-center gap-2 px-1.5">
                    <button type="button" onClick={() => setColorEditingId(colorEditingId === tag.id ? null : tag.id)} aria-label={t("tags.change_color")} className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] transition-transform hover:scale-110">
                      {tag.color ? (<span className="size-3 rounded-full" style={{ background: tag.color }}/>) : (<span className="size-3 rounded-full bg-[var(--text-quaternary)] opacity-40"/>)}
                    </button>
                    {renamingId === tag.id ? (<input value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => {
                          if (event.key === 'Enter')
                              void commitRename(tag);
                          else if (event.key === 'Escape')
                              setRenamingId(null);
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
                      {TAG_PRESET_COLORS.map((color) => (<button key={color} type="button" onClick={() => void applyColor(tag, color)} aria-label={color} className="size-5 rounded-full border border-[var(--border-default)] transition-transform hover:scale-110" style={{ background: color }}/>))}
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
