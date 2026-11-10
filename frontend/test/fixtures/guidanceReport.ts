import { WRAPUP_HEADERS, type WeeklyWrapup } from '@weboptions/shared';

export function guidanceReport(): WeeklyWrapup {
    return {
        version: 1,
        id: '2025-08-08',
        sourceUrl: 'https://example.com/report',
        sourceHash: 'a'.repeat(64),
        importedAt: '2025-08-10T12:00:00-07:00',
        sections: {
            management: {
                name: 'Management Plan',
                start: '2025-08-11',
                end: '2025-08-15',
                quoteDate: '2025-08-08',
                headerRows: [3],
                sourceRows: 7,
                audit: { calls: [], notes: [1, 2] },
                tables: [
                    {
                        kind: 'management',
                        headers: [...WRAPUP_HEADERS.management],
                        rows: ['RED', 'YELLOW', 'GREEN', 'UNKNOWN'].map((zone, index) => ({
                            sourceRow: index + 4,
                            contract: {
                                symbol: index === 3 ? 'AMD' : 'AAPL',
                                optionRight: 'P',
                                strike: 100,
                                expiration: '2025-08-15',
                            },
                            newContract: null,
                            cells: [
                                zone,
                                'HOLD',
                                'Source category',
                                index === 3 ? 'AMD' : 'AAPL',
                                '1',
                                '$100P',
                                '2025-08-15',
                                '$105',
                                '-20%',
                                '-0.3',
                                `Publisher note ${index + 4}`,
                            ],
                        })),
                    },
                ],
            },
            closed: {
                name: 'Closed Trades',
                start: '2025-08-04',
                end: '2025-08-08',
                quoteDate: null,
                tables: [{ kind: 'closed', headers: [...WRAPUP_HEADERS.closed], rows: [] }],
                headerRows: [1],
                sourceRows: 1,
                audit: { calls: [], notes: [] },
            },
            rolls: {
                name: 'Rolls',
                start: '2025-08-04',
                end: '2025-08-08',
                quoteDate: null,
                tables: [{ kind: 'rolls', headers: [...WRAPUP_HEADERS.rolls], rows: [] }],
                headerRows: [1],
                sourceRows: 1,
                audit: { calls: [], notes: [] },
            },
        },
    };
}
