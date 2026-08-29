import { encodeCsv, neutraliseSpreadsheetFormula } from '../src/csv.js';

function equal<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected)
        throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

equal(neutraliseSpreadsheetFormula('=1+1'), "'=1+1", 'formula prefixes are neutralised');
equal(neutraliseSpreadsheetFormula('  @SUM(A1:A2)'), "'  @SUM(A1:A2)", 'formula prefixes after whitespace are neutralised');
equal(neutraliseSpreadsheetFormula('ordinary text'), 'ordinary text', 'ordinary strings are unchanged');
equal(
    encodeCsv([['name', 'value'], ['quoted "name"', '=2+2'], ['negative number', -12]]),
    '"name","value"\r\n"quoted ""name""","\'=2+2"\r\n"negative number","-12"',
    'CSV quoting, line endings, formula protection, and numeric negatives are preserved',
);

console.log('CSV regression tests passed.');
