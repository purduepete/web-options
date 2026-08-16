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
