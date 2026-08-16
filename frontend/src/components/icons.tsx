import type { SVGProps } from 'react';

/**
 * Lucide-style stroke icons, inlined rather than pulled from a package: the set
 * is small and the app has to work with no network beyond the API.
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
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
    );
}

export function MoonIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
    );
}

export function MoonStarIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M12.5 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            <path d="M20 3v4M22 5h-4" />
        </svg>
    );
}

export function MonitorIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <rect x="2" y="3" width="20" height="14" />
            <path d="M8 21h8M12 17v4" />
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

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M18 6 6 18M6 6l12 12" />
        </svg>
    );
}

export function StarIcon({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
    return (
        <svg {...base} fill={filled ? 'currentColor' : 'none'} {...props}>
            <path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.8l6.5-.9Z" />
        </svg>
    );
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </svg>
    );
}

export function KeyIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <circle cx="7.5" cy="15.5" r="4.5" />
            <path d="m10.7 12.3 8.3-8.3M17 6l2 2M14 9l2 2" />
        </svg>
    );
}

export function PageIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
            <path d="M14 3v5h5M9 13h6M9 17h4" />
        </svg>
    );
}

export function CalendarIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <rect x="3" y="5" width="18" height="16" rx="1" />
            <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
    );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
        </svg>
    );
}

export function SlidersIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="16" cy="18" r="2" />
        </svg>
    );
}

