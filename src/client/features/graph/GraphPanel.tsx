import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minus, Plus, X } from 'lucide-react';
import type { GraphResponse } from '@shared/types';
import { truncateText } from '@shared/text-utils';
import { api } from '../../lib/api';
import { Button, IconButton } from '../../components/primitives';
import { Tooltip, useDialogFocus, useEscape, useLockScroll } from '../../components/overlay';
import { Empty, LoadingBlock } from '../../components/feedback';
import { useNotes } from '../../store/notes';
import { useUi } from '../../store/ui';
import { t } from "../../lib/i18n";
const GRAPH_NODE_LIMIT = 300;
const PHYSICS_FRAME_LIMIT = 360;
export function graphScaleAfterWheel(scale: number, deltaY: number): number {
    if (!Number.isFinite(deltaY) || deltaY === 0)
        return scale;
    return Math.min(4, Math.max(0.2, scale * (deltaY > 0 ? 0.92 : 1.08)));
}
interface Node {
    id: string;
    title: string;
    degree: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
}


export function GraphPanel({ onClose }: {
    onClose: () => void;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const titleId = useId();
    const [data, setData] = useState<GraphResponse | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reload, setReload] = useState(0);
    const [hover, setHover] = useState<Node | null>(null);
    const openNote = useNotes((s) => s.openNote);
    const activeNoteId = useUi((s) => s.activeNoteId);
    const hoverRef = useRef<Node | null>(null);
    const activeNoteIdRef = useRef(activeNoteId);
    const stateRef = useRef({
        nodes: [] as Node[],
        edges: [] as {
            a: Node;
            b: Node;
        }[],
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        dragging: null as {
            node: Node | null;
            startX: number;
            startY: number;
            ox: number;
            oy: number;
        } | null,
        frame: 0,
        raf: 0,
        schedule: null as (() => void) | null,
    });
    useEscape(true, onClose);
    useLockScroll(true);
    useDialogFocus(true, panelRef);
    useEffect(() => {
        let cancelled = false;
        setData(null);
        setLoadError(null);
        api
            .graph()
            .then((result) => {
            if (!cancelled)
                setData(result);
        })
            .catch((error) => {
            if (!cancelled)
                setLoadError(error instanceof Error ? error.message : String(error));
        });
        return () => {
            cancelled = true;
        };
    }, [reload]);
    useEffect(() => {
        activeNoteIdRef.current = activeNoteId;
        stateRef.current.schedule?.();
    }, [activeNoteId]);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !data)
            return;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        const S = stateRef.current;
        const limited = data.nodes.slice(0, GRAPH_NODE_LIMIT);
        const ids = new Set(limited.map((n) => n.id));
        hoverRef.current = null;
        setHover(null);

        S.nodes = limited.map((node, index) => {
            const angle = index * 2.399963;
            const radius = 16 * Math.sqrt(index);
            return {
                id: node.id,
                title: node.title,
                degree: node.degree,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                vx: 0,
                vy: 0,
                r: 3.5 + Math.min(9, Math.sqrt(node.degree) * 2.6),
            };
        });
        const byId = new Map(S.nodes.map((n) => [n.id, n]));
        S.edges = data.edges
            .filter((e) => ids.has(e.source) && ids.has(e.target))
            .map((e) => ({ a: byId.get(e.source)!, b: byId.get(e.target)! }));
        S.frame = 0;
        const resize = () => {
            const dpr = Math.min(2, devicePixelRatio || 1);
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            S.offsetX = rect.width / 2;
            S.offsetY = rect.height / 2;
            S.schedule?.();
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        const style = getComputedStyle(document.documentElement);
        const colors = {
            edge: style.getPropertyValue('--border-strong').trim() || 'rgba(255,255,255,.16)',
            node: style.getPropertyValue('--text-tertiary').trim(),
            accent: style.getPropertyValue('--accent').trim(),
            text: style.getPropertyValue('--text-secondary').trim(),
            bg: style.getPropertyValue('--bg-base').trim(),
        };
        const schedule = () => {
            if (!S.raf)
                S.raf = requestAnimationFrame(tick);
        };
        const tick = () => {
            S.raf = 0;
            const rect = canvas.getBoundingClientRect();

            if (S.frame < PHYSICS_FRAME_LIMIT) {
                S.frame++;
                const nodes = S.nodes;
                const repulsion = 900;
                for (let i = 0; i < nodes.length; i++) {
                    const a = nodes[i]!;
                    for (let j = i + 1; j < nodes.length; j++) {
                        const b = nodes[j]!;
                        let dx = b.x - a.x;
                        let dy = b.y - a.y;
                        let distSq = dx * dx + dy * dy;
                        if (distSq < 0.01) {
                            dx = (Math.random() - 0.5) * 0.6;
                            dy = (Math.random() - 0.5) * 0.6;
                            distSq = 0.36;
                        }
                        if (distSq > 90000)
                            continue;
                        const force = repulsion / distSq;
                        const dist = Math.sqrt(distSq);
                        const fx = (dx / dist) * force;
                        const fy = (dy / dist) * force;
                        a.vx -= fx;
                        a.vy -= fy;
                        b.vx += fx;
                        b.vy += fy;
                    }

                    a.vx -= a.x * 0.0022;
                    a.vy -= a.y * 0.0022;
                }
                for (const edge of S.edges) {
                    const dx = edge.b.x - edge.a.x;
                    const dy = edge.b.y - edge.a.y;
                    const dist = Math.hypot(dx, dy) || 1;
                    const force = (dist - 72) * 0.008;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    edge.a.vx += fx;
                    edge.a.vy += fy;
                    edge.b.vx -= fx;
                    edge.b.vy -= fy;
                }
                let totalMovement = 0;
                for (const node of nodes) {
                    if (S.dragging?.node === node)
                        continue;
                    node.vx *= 0.86;
                    node.vy *= 0.86;
                    const moveX = Math.max(-8, Math.min(8, node.vx));
                    const moveY = Math.max(-8, Math.min(8, node.vy));
                    node.x += moveX;
                    node.y += moveY;
                    totalMovement += Math.abs(moveX) + Math.abs(moveY);
                }
                if (S.frame > 90 && totalMovement < nodes.length * 0.01) {
                    S.frame = PHYSICS_FRAME_LIMIT;
                }
            }

            ctx.clearRect(0, 0, rect.width, rect.height);
            ctx.save();
            ctx.translate(S.offsetX, S.offsetY);
            ctx.scale(S.scale, S.scale);
            const hoverId = hoverRef.current?.id;
            ctx.lineWidth = 1 / S.scale;
            for (const edge of S.edges) {
                const related = hoverId === edge.a.id || hoverId === edge.b.id;
                ctx.strokeStyle = related ? colors.accent : colors.edge;
                ctx.globalAlpha = related ? 0.75 : hoverId ? 0.18 : 0.42;
                ctx.beginPath();
                ctx.moveTo(edge.a.x, edge.a.y);
                ctx.lineTo(edge.b.x, edge.b.y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            for (const node of S.nodes) {
                const isActive = node.id === activeNoteIdRef.current;
                const isHover = node.id === hoverId;
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
                ctx.fillStyle = isActive || isHover ? colors.accent : colors.node;
                ctx.globalAlpha = hoverId && !isHover && !isActive ? 0.35 : 1;
                ctx.fill();
                if (isActive) {
                    ctx.strokeStyle = colors.accent;
                    ctx.globalAlpha = 0.35;
                    ctx.lineWidth = 3 / S.scale;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, node.r + 4, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
            ctx.globalAlpha = 1;

            if (S.scale > 0.75 || hoverId) {
                ctx.font = `${11 / S.scale}px ${style.getPropertyValue('--font-ui')}`;
                ctx.textAlign = 'center';
                for (const node of S.nodes) {
                    const isHover = node.id === hoverId;
                    if (!isHover && node.degree < 1 && S.scale < 1.1)
                        continue;
                    ctx.fillStyle = isHover ? colors.accent : colors.text;
                    ctx.globalAlpha = isHover ? 1 : hoverId ? 0.3 : 0.7;
                    const label = node.title.length > 14 ? `${truncateText(node.title, 14)}…` : node.title;
                    ctx.fillText(label, node.x, node.y + node.r + 12 / S.scale);
                }
                ctx.globalAlpha = 1;
            }
            ctx.restore();
            if (S.frame < PHYSICS_FRAME_LIMIT)
                schedule();
        };
        S.schedule = schedule;
        schedule();
        return () => {
            cancelAnimationFrame(S.raf);
            S.raf = 0;
            S.schedule = null;
            observer.disconnect();
        };
    }, [data]);
    const toWorld = (event: React.MouseEvent) => {
        const S = stateRef.current;
        const rect = canvasRef.current!.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left - S.offsetX) / S.scale,
            y: (event.clientY - rect.top - S.offsetY) / S.scale,
        };
    };
    const nodeAt = (x: number, y: number): Node | null => {
        const S = stateRef.current;
        for (let i = S.nodes.length - 1; i >= 0; i--) {
            const node = S.nodes[i]!;
            if (Math.hypot(node.x - x, node.y - y) <= node.r + 5)
                return node;
        }
        return null;
    };
    return createPortal(<div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fixed inset-0 z-[230] flex flex-col bg-[var(--bg-base)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none md:py-0">
      <header className="flex min-h-12 shrink-0 flex-col items-stretch justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2 md:h-12 md:flex-row md:items-center md:px-4 md:py-0">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 id={titleId} className="text-[14px] font-semibold tracking-[-0.014em]">{t("common.graph")}</h2>
          {data && (<span className="text-[11.5px] text-[var(--text-quaternary)]">
              {data.nodes.length}{t("graph.notes")}{data.edges.length}{t("graph.links")}</span>)}
        </div>
        <div className="flex min-w-0 items-center gap-1">
          {data && data.nodes.length > 0 && (<select aria-label={t("graph.open_a_note_from_the_graph")} value="" onChange={(event) => {
            const id = event.target.value;
            if (!id)
                return;
            void openNote(id);
            onClose();
        }} className="mr-1 h-10 min-w-0 flex-1 rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 text-[11.5px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)] md:h-7 md:w-[min(36vw,240px)] md:flex-none">
              <option value="">{t("graph.choose_a_note")}</option>
              {data.nodes.slice(0, GRAPH_NODE_LIMIT).map((node) => (<option key={node.id} value={node.id}>{node.title || t("common.untitled_note")}</option>))}
            </select>)}
          <Tooltip label={t("common.zoom_out")}>
            <IconButton label={t("common.zoom_out")} size="sm" disabled={!data?.nodes.length} onClick={() => {
                const S = stateRef.current;
                S.scale = Math.max(0.2, S.scale - 0.2);
                S.schedule?.();
            }}>
              <Minus size={14}/>
            </IconButton>
          </Tooltip>
          <Tooltip label={t("graph.reset")}>
            <IconButton label={t("graph.reset")} size="sm" disabled={!data?.nodes.length} onClick={() => {
                const S = stateRef.current;
                S.scale = 1;
                const rect = canvasRef.current!.getBoundingClientRect();
                S.offsetX = rect.width / 2;
                S.offsetY = rect.height / 2;
                S.frame = 0;
                S.schedule?.();
            }}>
              <Maximize2 size={13}/>
            </IconButton>
          </Tooltip>
          <Tooltip label={t("common.zoom_in")}>
            <IconButton label={t("common.zoom_in")} size="sm" disabled={!data?.nodes.length} onClick={() => {
                const S = stateRef.current;
                S.scale = Math.min(4, S.scale + 0.2);
                S.schedule?.();
            }}>
              <Plus size={14}/>
            </IconButton>
          </Tooltip>
          <Tooltip label={t("common.close")} combo="escape" side="left">
            <IconButton label={t("common.close")} size="sm" onClick={onClose} className="ml-1">
              <X size={16}/>
            </IconButton>
          </Tooltip>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {loadError ? (<Empty art="notes" title={t("graph.could_not_load_graph")} description={loadError} action={<Button size="sm" variant="secondary" onClick={() => setReload((value) => value + 1)}>{t("common.retry")}</Button>}/>) : !data ? (<LoadingBlock label={t("graph.building_graph")}/>) : data.nodes.length === 0 ? (<Empty art="notes" title={t("graph.nothing_to_graph_yet")} description={t("graph.connect_notes_with_wiki_links_and_their_graph_will_appear_here")}/>) : (<>
            <canvas ref={canvasRef} role="img" aria-label={t("graph.graph_canvas_drag_to_pan_and_scroll_to_zoom_keyboard_users_can_open_note")} className="size-full cursor-grab active:cursor-grabbing" onMouseDown={(event) => {
                if (event.button !== 0)
                    return;
                const S = stateRef.current;
                const point = toWorld(event);
                const node = nodeAt(point.x, point.y);
                S.dragging = {
                    node,
                    startX: event.clientX,
                    startY: event.clientY,
                    ox: S.offsetX,
                    oy: S.offsetY,
                };
            }} onMouseMove={(event) => {
                const S = stateRef.current;
                const point = toWorld(event);
                if (S.dragging) {
                    if (S.dragging.node) {
                        S.dragging.node.x = point.x;
                        S.dragging.node.y = point.y;
                        S.dragging.node.vx = 0;
                        S.dragging.node.vy = 0;
                        if (S.frame > PHYSICS_FRAME_LIMIT - 80) {
                            S.frame = PHYSICS_FRAME_LIMIT - 100;
                        }
                    }
                    else {
                        S.offsetX = S.dragging.ox + (event.clientX - S.dragging.startX);
                        S.offsetY = S.dragging.oy + (event.clientY - S.dragging.startY);
                    }
                    S.schedule?.();
                    return;
                }
                const node = nodeAt(point.x, point.y);
                if (hoverRef.current?.id !== node?.id) {
                    hoverRef.current = node;
                    setHover(node);
                    S.schedule?.();
                }
            }} onMouseUp={(event) => {
                const S = stateRef.current;
                const drag = S.dragging;
                S.dragging = null;
                if (!drag)
                    return;
                const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
                if (drag.node && moved < 4) {
                    void openNote(drag.node.id);
                    onClose();
                }
            }} onMouseLeave={() => {
                const S = stateRef.current;
                S.dragging = null;
                hoverRef.current = null;
                setHover(null);
                S.schedule?.();
            }} onWheel={(event) => {
                const S = stateRef.current;
                const rect = canvasRef.current!.getBoundingClientRect();
                const mx = event.clientX - rect.left;
                const my = event.clientY - rect.top;
                const next = graphScaleAfterWheel(S.scale, event.deltaY);
                if (next === S.scale)
                    return;
                event.preventDefault();
                S.offsetX = mx - ((mx - S.offsetX) / S.scale) * next;
                S.offsetY = my - ((my - S.offsetY) / S.scale) * next;
                S.scale = next;
                S.schedule?.();
            }}/>

            {hover && (<div className="pointer-events-none absolute bottom-4 left-1/2 max-w-[70vw] -translate-x-1/2 truncate rounded-full border border-[var(--border-default)] bg-[var(--bg-overlay)] px-3.5 py-1.5 text-[12px] shadow-[var(--shadow-pop)]">
                {hover.title}
                <span className="ml-2 text-[var(--text-quaternary)]">{hover.degree}{t("graph.links")}</span>
              </div>)}

            <div className="pointer-events-none absolute top-3 left-4 hidden text-[11px] text-[var(--text-quaternary)] md:block">{t("graph.drag_to_pan_scroll_to_zoom_click_a_node_to_open_it_use_the_selector_abov")}</div>
          </>)}
      </div>
    </div>, document.body);
}
