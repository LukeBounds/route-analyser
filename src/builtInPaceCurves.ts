import type { PaceCurvePoint } from './core.js';

export type BuiltInPaceCurve = {
    key: string;
    name: string;
    points: PaceCurvePoint[];
};

const grades = [-55, -50, -45, -40, -35, -30, -25, -20, -15, -10, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const builtIn = (key: string, name: string, paces: string[]): BuiltInPaceCurve => ({
    key,
    name,
    points: grades.map((grade, index) => ({ grade, pace: paces[index] })),
});

export const builtInPaceCurves: BuiltInPaceCurve[] = [
    builtIn('18h-bob', '18h Bob', [
        'vam:2225', 'vam:2115', 'vam:2005', 'vam:1895', 'vam:1780', 'vam:1670', 'vam:1560', 'vam:1450', 'vam:1335',
        '5:25', '5:05', '5:05', '4:40', '4:50', '5:25', '6:00', '6:10', '6:45',
        '7:00', '9:40', '9:45', '10:20', 'vam:695', 'vam:780', 'vam:810',
        'vam:835', 'vam:865', 'vam:890', 'vam:920', 'vam:945', 'vam:975',
    ]),
    builtIn('21h-bob', '21h Bob', [
        'vam:1985', 'vam:1880', 'vam:1780', 'vam:1675', 'vam:1570', 'vam:1465', 'vam:1360', 'vam:1255', 'vam:1150',
        '6:40', '5:55', '5:55', '6:00', '6:15', '6:25', '7:00', '7:05', '7:20',
        '10:25', '10:35', '11:00', 'vam:525', 'vam:575', 'vam:625', 'vam:680',
        'vam:730', 'vam:760', 'vam:785', 'vam:810', 'vam:835', 'vam:865',
    ]),
    builtIn('24h-bob', '24h Bob', [
        'vam:1390', 'vam:1335', 'vam:1280', 'vam:1230', 'vam:1175', 'vam:1120', 'vam:1070', 'vam:1015', 'vam:960',
        '7:00', '6:35', '6:20', '6:05', '6:10', '6:35', '7:00', '7:05', '7:20',
        '10:15', '10:25', '10:45', 'vam:430', 'vam:480', 'vam:535', 'vam:590',
        'vam:640', 'vam:695', 'vam:750', 'vam:800', 'vam:855', 'vam:910',
    ]),
    builtIn('24h-bob-slower-downhill', '24h Bob Slower Downhill', [
        'vam:980', 'vam:955', 'vam:925', 'vam:900', 'vam:870', 'vam:845', 'vam:815', 'vam:765', 'vam:710', 'vam:625',
        '7:20', '6:30', '6:40', '6:45', '6:55', '7:00', '7:05', '7:15', '10:10',
        '10:15', '10:35', 'vam:545', 'vam:655', 'vam:710', 'vam:765', 'vam:790',
        'vam:815', 'vam:845', 'vam:870', 'vam:900', 'vam:925',
    ]),
];
