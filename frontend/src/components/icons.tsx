import type { SVGProps } from 'react';

/**
 * Lucide stroke icons, inlined rather than pulled from the package: the set is
 * small and the app has to work with no network beyond the API. The path data is
 * transcribed from lucide itself so these are the same glyphs as the sibling
 * apps, not lookalikes.
 */

const base: SVGProps<SVGSVGElement> = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
};

export function SunIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
        </svg>
    );
}

export function MoonIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
        </svg>
    );
}

export function MoonStarIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M18 5h4" />
            <path d="M20 3v4" />
            <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
        </svg>
    );
}

export function MonitorIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <rect width="20" height="14" x="2" y="3" rx="2" />
            <line x1="8" x2="16" y1="21" y2="21" />
            <line x1="12" x2="12" y1="17" y2="21" />
        </svg>
    );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M20 6 9 17l-5-5" />
        </svg>
    );
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m6 9 6 6 6-6" />
        </svg>
    );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m15 18-6-6 6-6" />
        </svg>
    );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m9 18 6-6-6-6" />
        </svg>
    );
}

export function ChevronFirstIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m17 18-6-6 6-6" />
            <path d="M7 6v12" />
        </svg>
    );
}

export function ChevronLastIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m7 18 6-6-6-6" />
            <path d="M17 6v12" />
        </svg>
    );
}

export function TargetIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
        </svg>
    );
}

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M4 5h16" />
            <path d="M4 12h16" />
            <path d="M4 19h16" />
        </svg>
    );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    );
}

export function StarIcon({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
    return (
        <svg {...base} fill={filled ? 'currentColor' : 'none'} {...props}>
            <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
        </svg>
    );
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
        </svg>
    );
}

export function KeyIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
            <path d="m21 2-9.6 9.6" />
            <circle cx="7.5" cy="15.5" r="5.5" />
        </svg>
    );
}

export function PageIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
            <path d="M14 2v5a1 1 0 0 0 1 1h5" />
            <path d="M10 9H8" />
            <path d="M16 13H8" />
            <path d="M16 17H8" />
        </svg>
    );
}

export function CalendarIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M8 2v3" />
            <path d="M16 2v3" />
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
        </svg>
    );
}

export function TableIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M3 15h18" />
            <path d="M12 9v12" />
        </svg>
    );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m21 21-4.34-4.34" />
            <circle cx="11" cy="11" r="8" />
        </svg>
    );
}

export function CircleArrowRightIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <circle cx="12" cy="12" r="10" />
            <path d="m12 16 4-4-4-4" />
            <path d="M8 12h8" />
        </svg>
    );
}

export function ZapIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 1.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z" />
        </svg>
    );
}

export function FlaskConicalIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" />
            <path d="M6.453 15h11.094" />
            <path d="M8.5 2h7" />
        </svg>
    );
}

export function SlidersIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M10 5H3" />
            <path d="M12 19H3" />
            <path d="M14 3v4" />
            <path d="M16 17v4" />
            <path d="M21 12h-9" />
            <path d="M21 19h-5" />
            <path d="M21 5h-7" />
            <path d="M8 10v4" />
            <path d="M8 12H3" />
        </svg>
    );
}

export function DollarIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M12 2v20" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
    );
}

export function AlertIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
        </svg>
    );
}

export function ActivityIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
        </svg>
    );
}

export function RotateCcwIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
        </svg>
    );
}

export function WrenchIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />
        </svg>
    );
}

export function TrendingUpIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M16 7h6v6" />
            <path d="m22 7-8.5 8.5-5-5L2 17" />
        </svg>
    );
}

export function TrendingDownIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M16 17h6v-6" />
            <path d="m22 17-8.5-8.5-5 5L2 7" />
        </svg>
    );
}

export function ArrowUpDownIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m21 16-4 4-4-4" />
            <path d="M17 20V4" />
            <path d="m3 8 4-4 4 4" />
            <path d="M7 4v16" />
        </svg>
    );
}

/** The bars widen downwards, which is how a list reads when it is sorted ascending. */
export function ArrowDownNarrowWideIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m3 16 4 4 4-4" />
            <path d="M7 20V4" />
            <path d="M11 4h4" />
            <path d="M11 8h7" />
            <path d="M11 12h10" />
        </svg>
    );
}

export function ArrowUpNarrowWideIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="m3 8 4-4 4 4" />
            <path d="M7 4v16" />
            <path d="M11 12h4" />
            <path d="M11 16h7" />
            <path d="M11 20h10" />
        </svg>
    );
}
