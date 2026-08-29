import type { PaceCurvePoint } from './core.js';

export type BuiltInPaceCurve = {
    key: string;
    name: string;
    points: PaceCurvePoint[];
};

const grades = [-40, -35, -30, -25, -20, -15, -10, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 35, 40];
const builtIn = (key: string, name: string, paces: string[]): BuiltInPaceCurve => ({
    key,
    name,
    points: grades.map((grade, index) => ({ grade, pace: paces[index] })),
});

export const builtInPaceCurves: BuiltInPaceCurve[] = [
    builtIn('21h', '21h', [
        'vam:1600', 'vam:1500', 'vam:1400', 'vam:1300', 'vam:1200', 'vam:1100',
        '7:00', '6:10', '6:10', '6:10', '6:20', '6:30', '7:00', '7:10', '7:30',
        '10:40', '11:00', '11:30', 'vam:500', 'vam:550', 'vam:600', 'vam:650',
        'vam:700', 'vam:725', 'vam:750',
    ]),
    builtIn('24h', '24h', [
        'vam:1150', 'vam:1100', 'vam:1050', 'vam:1000', 'vam:950', 'vam:900',
        '7:30', '7:00', '6:40', '6:20', '6:20', '6:40', '7:00', '7:10', '7:30',
        '10:40', '11:00', '11:30', 'vam:400', 'vam:450', 'vam:500', 'vam:550',
        'vam:600', 'vam:650', 'vam:700',
    ]),
    builtIn('optimistic', 'Optimistic', [
        'vam:1700', 'vam:1600', 'vam:1500', 'vam:1400', 'vam:1300', 'vam:1200',
        '6:00', '5:40', '5:30', '5:00', '5:00', '5:30', '6:00', '6:20', '7:00',
        '7:30', '10:30', '10:50', '11:30', 'vam:625', 'vam:700', 'vam:725',
        'vam:750', 'vam:775', 'vam:800',
    ]),
    builtIn('24h-slower-downhill', '24h Slower Downhill', [
        'vam:825', 'vam:800', 'vam:775', 'vam:750', 'vam:700', 'vam:650', 'vam:575',
        '8:00', '7:00', '7:00', '7:00', '7:00', '7:00', '7:10', '7:30', '10:40',
        '11:00', '11:30', 'vam:500', 'vam:600', 'vam:650', 'vam:700', 'vam:725',
        'vam:750', 'vam:775',
    ]),
];
