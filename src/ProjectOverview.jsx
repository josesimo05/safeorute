import {useId, useRef, useState} from 'react';
import {useI18n} from './LocaleContext';
import './project-overview.css';

const steps = [
  'Reporta un incidente con una ubicación aproximada; se revisa antes de publicarse.',
  'Busca un lugar y compara rutas con reportes cercanos. Los tiempos no incluyen tráfico en vivo.',
  'Abre el piloto para probar la revisión y publicación simulada de un aviso.',
];

const scope = [
  {title:'Funcionando', className:'available', text:'Mapas, reportes y navegación; los servicios conectados necesitan Internet.'},
  {title:'Simulado', className:'simulated', text:'El tráfico por cámaras (ITS) y el panel de autoridades usan datos ficticios; no envían avisos reales.'},
  {title:'Por validar', className:'pending', text:'Cámaras autorizadas, mediciones de campo y cuentas institucionales.'},
];

// This visitor guide has no data access or reporting side effects. Keeping it
// collapsed leaves room for the map, while its purpose and pilot link remain
// discoverable before a visitor knows the app's navigation.
export default function ProjectOverview() {
  const {t} = useI18n();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const toggle = useRef(null);

  function close() {
    setOpen(false);
    toggle.current?.focus();
  }

  return <section className="project-overview">
    <p className="project-mobile-purpose">{t('Consulta reportes comunitarios y compara rutas con más contexto.')}</p>
    <div className="project-overview-actions">
      <button ref={toggle} type="button" className="project-overview-toggle" aria-expanded={open}
        aria-controls={detailsId} onClick={() => setOpen(value => !value)}>
        {t('Cómo funciona')}<span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <a className="project-overview-pilot" href="/piloto/">{t('Piloto de autoridades · Demo')}</a>
    </div>
    {open && <div id={detailsId} className="project-overview-guide" role="region" aria-label={t('Cómo funciona SafeRoute')}>
      <h2>{t('Cómo funciona SafeRoute')}</h2>
      <ol className="project-overview-steps">{steps.map(step => <li key={step}>{t(step)}</li>)}</ol>
      <div className="project-overview-scope">{scope.map(item => <div key={item.title} className={`project-overview-scope-item project-overview-${item.className}`}>
        <h3>{t(item.title)}</h3><p>{t(item.text)}</p>
      </div>)}</div>
      <button type="button" className="project-overview-close" onClick={close}>{t('Cerrar guía')}</button>
    </div>}
  </section>;
}
