import './style.css';
import './pace.css';
import { createPacePageController } from './pacePageController';
import { createRoutePageController } from './routePageController';
import { routePageTemplate } from './templates';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = routePageTemplate();

const paceController = createPacePageController(app);
const routeController = createRoutePageController(app, paceController);
const header = app.querySelector('header')!;

function syncWorkspace() {
    const showPacePage = location.hash === '#pace';
    routeController.page.hidden = showPacePage;
    paceController.panel.hidden = !showPacePage;
    header.querySelector('h1')!.textContent = showPacePage ? 'Pace curve' : 'Terrain analyser';
    header.querySelector('p:last-child')!.textContent = showPacePage
        ? 'Build and save your personal pace and VAM curve.'
        : 'Break GPX routes into useful climb, descent, flat, and rolling sections.';
    header.querySelectorAll<HTMLAnchorElement>('[data-page-link]').forEach(link => {
        const active = link.dataset.pageLink === (showPacePage ? 'pace' : 'route');
        if (active)
            link.setAttribute('aria-current', 'page');
        else
            link.removeAttribute('aria-current');
    });
    requestAnimationFrame(() => showPacePage ? paceController.redraw() : routeController.redraw());
}

window.addEventListener('hashchange', syncWorkspace);
syncWorkspace();

let chartResizeFrame = 0;
function scheduleChartRedraw() {
    cancelAnimationFrame(chartResizeFrame);
    chartResizeFrame = requestAnimationFrame(() => {
        if (!routeController.page.hidden)
            routeController.redraw();
        if (!paceController.panel.hidden)
            paceController.redraw();
    });
}
window.addEventListener('resize', scheduleChartRedraw);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleChartRedraw);

let observedAppWidth = 0;
const chartResizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (Math.abs(width - observedAppWidth) < 1)
        return;
    observedAppWidth = width;
    scheduleChartRedraw();
});
chartResizeObserver.observe(app);
