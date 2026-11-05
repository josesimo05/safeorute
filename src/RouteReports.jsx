import {useMemo} from 'react';
import {useI18n} from './LocaleContext';
import {approvedRouteReports, categories, colors} from './logic';
import './route-reports.css';

// This is a view of the shared, published feed. It does not fetch, recalculate
// a route, move the map, or expose a report while moderation is pending.
export default function RouteReports({route, reports, onFocus}) {
  const {t, language} = useI18n();
  const nearby = useMemo(() => approvedRouteReports(route, reports), [route, reports]);
  if (!route) return null;

  const reportDate = value => {
    const instant = Date.parse(value);
    return Number.isFinite(instant) ? new Date(instant).toLocaleString(language, {dateStyle:'short', timeStyle:'short'}) : '';
  };

  return <section className="route-reports" aria-label={t('Reportes cerca de esta ruta')}>
    <h3>{t('Reportes cerca de esta ruta')}</h3>
    <p className="route-reports-count" role="status">{t('{count} reportes a 150 m', {count:new Intl.NumberFormat(language).format(nearby.length)})}</p>
    <p className="route-reports-help">{t('Solo reportes aprobados para publicación; los hechos no están verificados.')}</p>
    {!nearby.length ? <p className="route-reports-empty">{t('No hay reportes aprobados a 150 m de esta ruta.')}</p>
      : <ul className="route-reports-list">{nearby.map((report, index) => {
        const category = typeof report.category === 'string' ? report.category : 'Otro';
        const color = colors[categories.indexOf(category)] || colors.at(-1);
        return <li key={report.id || `${report.lat}-${report.lng}-${index}`}>
          <button type="button" className="route-reports-item" onClick={() => onFocus?.(report)}>
            <span className="route-reports-category"><i aria-hidden="true" style={{background:color}} />{t(category)}</span>
            <span className="route-reports-description">{typeof report.description === 'string' ? report.description : ''}</span>
            <small>{[reportDate(report.occurredAt), t(report.source === 'simulated' ? 'Simulado' : 'Comunitario')].filter(Boolean).join(' · ')}</small>
            <span className="route-reports-action">{t('Ver reporte en el mapa')}</span>
          </button>
        </li>;
      })}</ul>}
  </section>;
}
