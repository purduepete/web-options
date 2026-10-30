import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

const TOOLTIP_ID = 'web-options-tooltip';
const TRIGGER_SELECTOR = '[data-tip]';
const VIEWPORT_PADDING = 8;
const TOOLTIP_GAP = 6;
const HIDE_DELAY_MS = 120;
const TOUCH_HIDE_MS = 1800;

interface ActiveTooltip {
    trigger: HTMLElement;
    text: string;
}

interface TooltipPosition {
    top: number;
    left: number;
}

function closestElement(target: EventTarget | null, selector: string): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

function addDescription(trigger: HTMLElement) {
    const ids = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (!ids.includes(TOOLTIP_ID)) {
        trigger.setAttribute('aria-describedby', [...ids, TOOLTIP_ID].join(' '));
    }
}

function removeDescription(trigger: HTMLElement) {
    const ids = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== TOOLTIP_ID);
    if (ids.length > 0) trigger.setAttribute('aria-describedby', ids.join(' '));
    else trigger.removeAttribute('aria-describedby');
}

export function TooltipLayer() {
    const [active, setActive] = useState<ActiveTooltip | null>(null);
    const [position, setPosition] = useState<TooltipPosition>({ top: -9999, left: -9999 });
    const activeRef = useRef<ActiveTooltip | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const hideTimer = useRef<number | null>(null);
    const touchTimer = useRef<number | null>(null);

    useEffect(() => {
        function clearTimers() {
            if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
            if (touchTimer.current !== null) window.clearTimeout(touchTimer.current);
            hideTimer.current = null;
            touchTimer.current = null;
        }

        function hide() {
            clearTimers();
            const current = activeRef.current;
            if (!current) return;
            removeDescription(current.trigger);
            activeRef.current = null;
            setActive(null);
        }

        function scheduleHide() {
            if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
            hideTimer.current = window.setTimeout(() => {
                const current = activeRef.current;
                if (current && document.activeElement !== current.trigger) hide();
            }, HIDE_DELAY_MS);
        }

        function show(trigger: HTMLElement) {
            const text = trigger.dataset.tip?.trim();
            if (!text) {
                hide();
                return;
            }
            clearTimers();
            const current = activeRef.current;
            if (current && current.trigger !== trigger) removeDescription(current.trigger);
            addDescription(trigger);
            const next = { trigger, text };
            activeRef.current = next;
            setActive(next);
        }

        function onPointerOver(event: PointerEvent) {
            if (closestElement(event.target, `#${TOOLTIP_ID}`)) {
                clearTimers();
                return;
            }
            const trigger = closestElement(event.target, TRIGGER_SELECTOR);
            if (trigger) show(trigger);
        }

        function onPointerOut(event: PointerEvent) {
            const related = event.relatedTarget;
            const trigger = closestElement(event.target, TRIGGER_SELECTOR);
            const tooltip = closestElement(event.target, `#${TOOLTIP_ID}`);
            if (!trigger && !tooltip) return;
            if (
                related instanceof Node &&
                ((trigger?.contains(related) ?? false) ||
                    (tooltip?.contains(related) ?? false) ||
                    closestElement(related, `#${TOOLTIP_ID}`) !== null ||
                    (activeRef.current?.trigger.contains(related) ?? false))
            ) {
                clearTimers();
                return;
            }
            scheduleHide();
        }

        function onPointerDown(event: PointerEvent) {
            const trigger = closestElement(event.target, TRIGGER_SELECTOR);
            if (trigger) {
                show(trigger);
                if (event.pointerType === 'touch') {
                    touchTimer.current = window.setTimeout(hide, TOUCH_HIDE_MS);
                }
                return;
            }
            if (!closestElement(event.target, `#${TOOLTIP_ID}`)) hide();
        }

        function onFocusIn(event: FocusEvent) {
            const trigger = closestElement(event.target, TRIGGER_SELECTOR);
            if (trigger) show(trigger);
        }

        function onFocusOut(event: FocusEvent) {
            const current = activeRef.current;
            if (
                current &&
                current.trigger.contains(event.target as Node) &&
                !(event.relatedTarget instanceof Node && current.trigger.contains(event.relatedTarget))
            ) {
                scheduleHide();
            }
        }

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') hide();
        }

        function onClick(event: MouseEvent) {
            const current = activeRef.current;
            if (!current) return;
            const target = event.target;
            if (target instanceof Node && !current.trigger.contains(target) && !tooltipRef.current?.contains(target)) {
                hide();
            }
        }

        document.addEventListener('pointerover', onPointerOver);
        document.addEventListener('pointerout', onPointerOut);
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('focusout', onFocusOut);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('click', onClick);
        window.addEventListener('scroll', hide, true);

        return () => {
            hide();
            document.removeEventListener('pointerover', onPointerOver);
            document.removeEventListener('pointerout', onPointerOut);
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('focusout', onFocusOut);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('click', onClick);
            window.removeEventListener('scroll', hide, true);
        };
    }, []);

    useLayoutEffect(() => {
        const current = active;
        if (!current || !tooltipRef.current) return;
        const trigger = current.trigger;
        function reposition() {
            const tooltip = tooltipRef.current;
            if (!tooltip || !trigger.isConnected) return;
            const triggerRect = trigger.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            let top = triggerRect.top - tooltipRect.height - TOOLTIP_GAP;
            if (top < VIEWPORT_PADDING) top = triggerRect.bottom + TOOLTIP_GAP;
            top = Math.max(VIEWPORT_PADDING, Math.min(top, window.innerHeight - tooltipRect.height - VIEWPORT_PADDING));
            const left = Math.max(
                VIEWPORT_PADDING,
                Math.min(
                    triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
                    window.innerWidth - tooltipRect.width - VIEWPORT_PADDING
                )
            );
            setPosition({ top, left });
        }

        reposition();
        window.addEventListener('resize', reposition);
        return () => window.removeEventListener('resize', reposition);
    }, [active]);

    if (!active) return null;

    return createPortal(
        <div
            ref={tooltipRef}
            id={TOOLTIP_ID}
            role="tooltip"
            className="app-tooltip"
            style={{ top: position.top, left: position.left }}
            onPointerEnter={() => {
                if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
                hideTimer.current = null;
            }}
        >
            {active.text}
        </div>,
        document.body
    );
}
