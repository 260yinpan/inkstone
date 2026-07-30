import { useEffect, useRef, useState, type RefObject } from 'react';
import { ListTree } from 'lucide-react';
import type { Heading } from '../../lib/markdown/renderer';
import { cn } from '../../lib/cn';
import { Tooltip } from '../../components/overlay';
import { t } from "../../lib/i18n";

export function Outline({ headings, onSelect, scrollerRef, className, }: {
    headings: Heading[];
    onSelect: (heading: Heading) => void;
    scrollerRef?: RefObject<HTMLElement | null>;
    className?: string;
}) {
    const [active, setActive] = useState<string | null>(null);
    const rafRef = useRef(0);
    useEffect(() => {
        const scroller = scrollerRef?.current ?? document.querySelector<HTMLElement>('[data-preview-scroller]');
        if (!scroller || headings.length === 0)
            return;
        const onScroll = () => {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
                const top = scroller.scrollTop + 60;
                let current: string | null = headings[0]?.slug ?? null;
                for (const heading of headings) {
                    const el = scroller.querySelector<HTMLElement>(`#${CSS.escape(heading.slug)}`);
                    if (!el)
                        continue;
                    if (el.offsetTop <= top)
                        current = heading.slug;
                    else
                        break;
                }
                setActive(current);
            });
        };
        onScroll();
        scroller.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            scroller.removeEventListener('scroll', onScroll);
            cancelAnimationFrame(rafRef.current);
        };
    }, [headings, scrollerRef]);
    if (headings.length === 0)
        return null;
    const minLevel = Math.min(...headings.map((h) => h.level));
    return (<nav className={cn('sticky top-0 max-h-full w-[168px] shrink-0 self-start overflow-y-auto py-5 pr-3', className)} aria-label={t("common.outline")}>
      <div className="mb-2 flex items-center gap-1.5 px-2 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--text-quaternary)]">
        <ListTree size={11}/>{t("common.outline")}</div>
      <ul className="space-y-px">
        {headings.map((heading, index) => {
            const isActive = heading.slug === active;
            return (<li key={`${heading.slug}-${index}`}>
              <Tooltip label={heading.text || t("preview.untitled")} side="left">
                <button type="button" aria-current={isActive ? 'location' : undefined} onClick={() => onSelect(heading)} className={cn('relative block w-full truncate rounded-[var(--r-sm)] py-1 pr-1.5 text-left text-[11.5px] leading-snug', 'transition-colors duration-[var(--dur-fast)]', isActive
                        ? 'font-medium text-[var(--accent)]'
                        : 'text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]')} style={{ paddingLeft: 8 + (heading.level - minLevel) * 10 }}>
                  {isActive && (<span className="absolute top-1/2 left-0 h-[13px] w-[2px] -translate-y-1/2 rounded-full bg-[var(--accent)]"/>)}
                  {heading.text || t("preview.untitled")}
                </button>
              </Tooltip>
            </li>);
        })}
      </ul>
    </nav>);
}
