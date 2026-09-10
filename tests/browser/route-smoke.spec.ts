import { expect, test } from '@playwright/test';

test('bundled route analysis and pace state survive page navigation', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', problem => pageErrors.push(problem.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Terrain analyser' })).toBeVisible();
    await expect(page.locator('#gradient-window')).toHaveValue('50');
    const restCheckbox = page.locator('#activity-rest-detection');
    expect(await restCheckbox.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(30);

    await page.getByRole('combobox', { name: 'Example route' }).selectOption('bob-graham-lukes-version');
    await page.getByRole('button', { name: 'Load example' }).click();

    await expect(page.getByText('Bob Graham — Luke’s Version: 3,948 points analysed across 101.91 km.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Analysis overview' })).toBeVisible();
    await expect(page.locator('#activity-analysis')).toHaveClass(/analysis-divider/);
    await expect(page.locator('#activity-analysis')).not.toHaveClass(/prediction/);
    await expect(page.getByRole('heading', { level: 2, name: 'Terrain-derived analysis' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Elevation profile' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Gradient exposure' })).toBeVisible();
    await expect(page.locator('.gradient-exposure-table tbody tr')).not.toHaveCount(0);
    await expect(page.locator('#gradient-exposure-metric option[value="time"]')).toHaveAttribute('disabled', '');
    await expect(page.locator('#gradient-exposure-metric option[value="time"]')).toHaveText('Predicted time — run pace analysis first');
    await expect(page.locator('#gradient-exposure-summary')).toContainText('Run pace analysis');
    await expect(page.getByRole('heading', { level: 3, name: 'Sections table' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Waypoint-defined analysis' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Waypoints' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Waypoint Segments' })).toBeVisible();
    await expect(page.locator('#stats').getByText('Profile elevation gain', { exact: true })).toBeVisible();
    await expect(page.locator('#stats').getByText('Profile elevation loss', { exact: true })).toBeVisible();
    await expect(page.locator('.elevation-stat').first()).toContainText('By section');
    await expect(page.locator('.elevation-stat').first()).toContainText('Raw');
    const terrainTiles = page.locator('#stats .stat:not(.elevation-stat)');
    await expect(terrainTiles.nth(0)).toContainText('Climb');
    await expect(terrainTiles.nth(1)).toContainText('Descent');
    await expect(terrainTiles.nth(2)).toContainText('Rolling');
    await expect(terrainTiles.nth(3)).toContainText('Flat');
    await expect(page.getByRole('columnheader', { name: 'Net elevation change' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Profile elevation gain' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Profile elevation loss' })).toBeVisible();
    await expect(page.locator('#waypoint-segments tbody tr')).not.toHaveCount(0);

    const analysisCurve = page.getByRole('combobox', { name: 'Pace curve for route analysis' });
    await analysisCurve.selectOption({ label: '24h Bob' });
    await page.getByRole('button', { name: 'Run pace analysis' }).click();

    await expect(page.getByText('Predicted time · 24h Bob')).toBeVisible();
    await expect(page.locator('#gradient-exposure-metric option[value="time"]')).not.toHaveAttribute('disabled', '');
    await expect(page.locator('#gradient-exposure-metric option[value="time"]')).toHaveText('Predicted time');
    await page.locator('#gradient-exposure-metric').selectOption('time');
    await expect(page.locator('#curve-point-influence')).toBeVisible();
    await expect(page.locator('#curve-point-influence')).toContainText('Pace-curve influence — 24h Bob');
    await expect(page.locator('#curve-point-influence tbody tr')).not.toHaveCount(0);
    await expect(page.locator('#stats .prediction-stat')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Predicted Pace Analysis — 24h Bob' })).toHaveCount(2);
    await expect(page.getByRole('columnheader', { name: 'Segment Average' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Local Gradient' })).toBeVisible();
    const terrainOverallSummary = page.locator('#section-summary .terrain-overall-summary');
    await expect(terrainOverallSummary).toContainText('Overall');
    await expect(terrainOverallSummary).toContainText('/km');
    const overallWaypointSummary = page.locator('#waypoint-segments tfoot .waypoint-overall-summary');
    await expect(overallWaypointSummary).toContainText('Overall');
    await expect(overallWaypointSummary).toContainText('/km');
    const selectedCurveId = await analysisCurve.inputValue();

    await page.getByRole('link', { name: 'Pace curve' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pace curve' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Curve to edit' })).toHaveValue(selectedCurveId);
    await expect(page.getByRole('heading', { name: 'Pace comparison' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Speed comparison' })).toBeVisible();

    await page.getByRole('link', { name: 'Terrain analyser' }).click();
    await expect(page.getByText('Bob Graham — Luke’s Version: 3,948 points analysed across 101.91 km.')).toBeVisible();
    await expect(page.getByText('Predicted time · 24h Bob')).toBeVisible();
    await expect(analysisCurve).toHaveValue(selectedCurveId);
    expect(pageErrors).toEqual([]);
});

test('an activity that does not match a loaded route shows a warning and keeps the route', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Example route' }).selectOption('bob-graham-lukes-version');
    await page.getByRole('button', { name: 'Load example' }).click();
    await expect(page.getByText('Bob Graham — Luke’s Version: 3,948 points analysed across 101.91 km.')).toBeVisible();

    const unrelatedActivity = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="route-analyser-test">
            <trk><trkseg>
                <trkpt lat="51.5000" lon="-0.1200"><ele>10</ele><time>2026-01-01T08:00:00Z</time></trkpt>
                <trkpt lat="51.5010" lon="-0.1200"><ele>11</ele><time>2026-01-01T08:01:00Z</time></trkpt>
                <trkpt lat="51.5020" lon="-0.1200"><ele>12</ele><time>2026-01-01T08:02:00Z</time></trkpt>
            </trkseg></trk>
        </gpx>`;
    await page.locator('#activity-file').evaluate((element, contents) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([contents], 'unrelated-activity.gpx', { type: 'application/gpx+xml' }));
        (element as HTMLInputElement).files = transfer.files;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }, unrelatedActivity);

    const warning = page.getByRole('alert').filter({ hasText: 'Activity not matched' });
    await expect(warning).toContainText('does not match the loaded route closely enough');
    await expect(warning).toContainText('loaded route is unchanged');
    await expect(page.getByRole('heading', { level: 2, name: 'Analysis overview' })).toBeVisible();
    await expect(page.getByText('Download activity comparison CSV')).toHaveCount(0);
});

test('a loaded route can generate and save a target-time pace curve', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', problem => pageErrors.push(problem.message));
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Example route' }).selectOption('bob-graham-lukes-version');
    await page.getByRole('button', { name: 'Load example' }).click();
    await expect(page.getByText('Bob Graham — Luke’s Version: 3,948 points analysed across 101.91 km.')).toBeVisible();

    await page.getByRole('link', { name: 'Pace curve' }).click();
    await expect(page.getByRole('heading', { name: 'Generate from a route' })).toBeVisible();
    await expect(page.locator('#pace-generator-controls')).toBeEnabled();
    await expect(page.locator('#pace-generator-route')).toContainText('Bob Graham — Luke’s Version · 101.91 km');
    await page.locator('#pace-generator-source').selectOption({ label: '24h Bob' });
    await page.locator('#pace-generator-target-hours').fill('26');
    await page.locator('#pace-generator-stop-hours').fill('1');
    await expect(page.locator('#pace-generator-preserve-flat')).toBeChecked();
    await page.getByLabel('Nice-number rounding').check();
    await page.getByRole('button', { name: 'Generate preview' }).click();

    const preview = page.locator('#pace-generator-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('25 h 0 min');
    await expect(preview).toContainText('the change tapers to zero at 0%');
    await expect(preview).toContainText('rounded to 5 seconds and VAM values to 5 m/h');
    await expect(page.locator('#pace-generator-status')).toContainText('Compare it below before saving.');
    await expect(page.locator('#pace-generator-chart')).toBeVisible();
    await expect(page.locator('#pace-generator-chart-legend')).toContainText('24h Bob');
    await expect(page.locator('#pace-generator-chart-legend')).toContainText('preview');
    await page.locator('#pace-generator-comparison-list').getByLabel('21h Bob').check();
    await expect(page.locator('#pace-generator-chart-legend')).toContainText('21h Bob');

    await page.locator('#pace-generator-name').fill('Bob Graham 26h elapsed');
    await page.getByRole('button', { name: 'Save as new curve' }).click();
    await expect(page.locator('#pace-curve-select option:checked')).toHaveText('Bob Graham 26h elapsed');
    await expect(page.locator('#pace-generator-status')).toContainText('is now selected and available for route analysis.');

    await page.getByRole('link', { name: 'Terrain analyser' }).click();
    await expect(page.locator('#analysis-curve-select option:checked')).toHaveText('Bob Graham 26h elapsed');
    expect(pageErrors).toEqual([]);
});

test('a generated curve is not added when browser storage rejects the save', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Example route' }).selectOption('bob-graham-lukes-version');
    await page.getByRole('button', { name: 'Load example' }).click();
    await expect(page.getByText('Bob Graham — Luke’s Version: 3,948 points analysed across 101.91 km.')).toBeVisible();

    await page.getByRole('link', { name: 'Pace curve' }).click();
    await page.locator('#pace-generator-source').selectOption({ label: '24h Bob' });
    await page.locator('#pace-generator-target-hours').fill('26');
    await page.getByRole('button', { name: 'Generate preview' }).click();
    const preview = page.locator('#pace-generator-preview');
    await expect(preview).toBeVisible();

    await page.evaluate(() => {
        const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
        (window as Window & { restoreStorageSetItem?: Storage['setItem'] }).restoreStorageSetItem = storagePrototype.setItem;
        storagePrototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
    });
    await page.getByRole('button', { name: 'Save as new curve' }).click();

    await expect(page.locator('#pace-generator-status')).toContainText('could not be saved in browser storage');
    await expect(preview).toBeVisible();
    await expect(page.locator('#pace-curve-select option')).toHaveCount(4);
    await page.evaluate(() => {
        const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
        const restore = (window as Window & { restoreStorageSetItem?: Storage['setItem'] }).restoreStorageSetItem;
        if (restore)
            storagePrototype.setItem = restore;
    });
});

test('pace curves can be reset to the built-in defaults after confirmation', async ({ page }) => {
    await page.goto('/#pace');
    const curveSelect = page.locator('#pace-curve-select');
    await expect(curveSelect.locator('option')).toHaveCount(4);
    await page.locator('[data-pace="0"]').fill('1903');
    await page.locator('[data-pace="0"]').press('Tab');
    await expect(page.locator('[data-pace="0"]')).toHaveValue('1903');
    await page.getByRole('button', { name: 'Round current curve now' }).click();
    await expect(page.locator('[data-pace="0"]')).toHaveValue('1905');
    await page.getByRole('button', { name: 'New curve' }).click();
    await expect(curveSelect.locator('option')).toHaveCount(5);

    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Reset all to defaults' }).click();
    await expect(curveSelect.locator('option')).toHaveCount(5);

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset all to defaults' }).click();
    await expect(curveSelect.locator('option')).toHaveCount(4);
    expect(await curveSelect.locator('option').allTextContents()).toEqual([
        '18h Bob', '21h Bob', '24h Bob', '24h Bob Slower Downhill',
    ]);
    await expect(curveSelect.locator('option:checked')).toHaveText('18h Bob');
    await expect(page.locator('#pace-library-status')).toContainText('replaced with the four built-in defaults');
});
