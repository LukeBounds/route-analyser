export type CsvValue = string | number | boolean | null | undefined;

export function neutraliseSpreadsheetFormula(value: string) {
    return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function encodeCsv(rows: CsvValue[][]) {
    return rows.map(row => row.map(value => {
        const text = value === null || value === undefined
            ? ''
            : typeof value === 'string'
                ? neutraliseSpreadsheetFormula(value)
                : String(value);
        return `"${text.replace(/"/g, '""')}"`;
    }).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, rows: CsvValue[][]) {
    const url = URL.createObjectURL(new Blob([`\uFEFF${encodeCsv(rows)}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
