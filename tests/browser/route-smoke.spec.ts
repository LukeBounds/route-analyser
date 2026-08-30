import { expect, test } from '@playwright/test';

test('bundled route analysis and pace state survive page navigation', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', problem => pageErrors.push(problem.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Terrain analyser' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Example route' }).selectOption('bob-graham-lukes-version');
    await page.getByRole('button', { name: 'Load example' }).click();

    await expect(page.getByText('Bob Graham — Luke’s Version: 3,948 points analysed across 101.91 km.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Terrain-derived sections' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waypoint-defined analysis' })).toBeVisible();
    await expect(page.locator('#waypoint-segments tbody tr')).not.toHaveCount(0);

    const analysisCurve = page.getByRole('combobox', { name: 'Pace curve for route analysis' });
    await analysisCurve.selectOption({ label: '24h' });
    await page.getByRole('button', { name: 'Run pace analysis' }).click();

    await expect(page.getByText('Predicted time · 24h')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Predicted Pace Analysis — 24h' })).toHaveCount(2);
    await expect(page.getByRole('columnheader', { name: 'Segment Average' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Local Gradient' })).toBeVisible();
    const selectedCurveId = await analysisCurve.inputValue();

    await page.getByRole('link', { name: 'Pace curve' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pace curve' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Curve to edit' })).toHaveValue(selectedCurveId);
    await expect(page.getByRole('heading', { name: 'Pace comparison' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Speed comparison' })).toBeVisible();

    await page.getByRole('link', { name: 'Terrain analyser' }).click();
    await expect(page.getByText('Bob Graham — Luke’s Version: 3,948 points analysed across 101.91 km.')).toBeVisible();
    await expect(page.getByText('Predicted time · 24h')).toBeVisible();
    await expect(analysisCurve).toHaveValue(selectedCurveId);
    expect(pageErrors).toEqual([]);
});
