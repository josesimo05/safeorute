import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useI18n} from './LocaleContext';
import {fetchItsSnapshot, itsCameraViews, itsCoordinates, ITS_POLL_MS} from './its-client';
import './its.css';

const congestionText = {fluido: 'Fluido', moderado: 'Moderado', denso: 'Denso', detenido: 'Detenido', desconocido: 'No disponible'};
const healthText = {healthy: 'Operativa', ok: 'Operativa', degraded: 'Calidad degradada', stale: 'Observación vencida',
  no_frames: 'Sin imágenes', source_unavailable: 'Fuente no disponible', freeze_suspected: 'Imagen posiblemente congelada',
  scene_changed: 'Revisar calibración', stopped: 'Procesamiento detenido', starting: 'Iniciando', unknown: 'No disponible'};

export default function ItsPanel({active = true, country = 'all', onCamerasChange, onFocusCamera}) {
  const {t, language} = useI18n();
  const [snapshot, setSnapshot] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const timing = useRef(null);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let disposed = false, controller = null, timer = null;
    const clear = () => {clearTimeout(timer); controller?.abort();};
    const available = () => navigator.onLine !== false && document.visibilityState !== 'hidden';
    const poll = async () => {
      clear();
      if (disposed) return;
      if (!available()) {setPhase(navigator.onLine === false ? 'offline' : 'paused'); return;}
      const request = new AbortController();
      controller = request;
      let timedOut = false;
      const timeout = setTimeout(() => {timedOut = true; request.abort();}, 12000);
      setPhase('loading');
      try {
        const next = await fetchItsSnapshot({signal: request.signal, previousTiming: timing.current});
        if (disposed || request.signal.aborted) return;
        timing.current = next.timing;
        setSnapshot(next); setNow(Date.now()); setPhase('connected');
      } catch {
        if (!disposed && available() && (!request.signal.aborted || timedOut)) setPhase('error');
      } finally {
        clearTimeout(timeout);
        if (!disposed && controller === request && available()) timer = setTimeout(poll, ITS_POLL_MS);
      }
    };
    const visibility = () => {
      clear();
      if (available()) poll(); else setPhase(navigator.onLine === false ? 'offline' : 'paused');
    };
    poll();
    window.addEventListener('online', visibility); window.addEventListener('offline', visibility);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true; clear();
      window.removeEventListener('online', visibility); window.removeEventListener('offline', visibility);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, attempt]);
  // On reactivation, evaluate time immediately instead of briefly painting an
  // old metric before the first timer/effect catches up.
  const cameras = useMemo(() => active ? itsCameraViews(snapshot, Math.max(now, Date.now()), country) : [], [active, snapshot, now, country]);
  useEffect(() => {onCamerasChange?.(cameras);}, [cameras, onCamerasChange]);
  const cameraById = useMemo(() => new Map(cameras.map(camera => [camera.id, camera])), [cameras]);
  const alerts = useMemo(() => (snapshot?.alerts || []).filter(alert => cameraById.has(alert.cameraId)), [snapshot, cameraById]);
  if (!active) return null;
  const fmt = (value, decimals = 0) => new Intl.NumberFormat(language, {maximumFractionDigits: decimals}).format(value);
  const date = value => new Date(value).toLocaleString(language, {dateStyle: 'short', timeStyle: 'medium'});
  const connectionText = phase === 'connected' ? 'Conectado al servicio ITS' : phase === 'loading' ? 'Consultando servicio ITS…'
    : phase === 'offline' ? 'Sin conexión a Internet' : phase === 'paused' ? 'Actualización en pausa' : 'Servicio ITS no disponible';

  return <section className="its-panel" aria-label={t('Datos de tráfico ITS')}>
    <div className="its-heading"><h2>{t('Datos de tráfico ITS')}</h2><span className="its-demo-badge">{t('Demostración · datos sintéticos')}</span></div>
    <p className="its-disclaimer">{t('Estas mediciones son generadas para probar el sistema. No describen el tránsito real ni cambian tus rutas.')}</p>
    <div className="its-connection"><span role="status"><i className={phase === 'connected' ? 'its-dot connected' : 'its-dot'} />{t(connectionText)}</span><button type="button" onClick={refresh} disabled={phase === 'loading'}>{t('Actualizar')}</button></div>
    {((phase === 'loading' && !snapshot) || phase === 'error') && <p className="its-help">{t('El alojamiento puede tardar en iniciar. SafeRoute volverá a intentarlo automáticamente.')}</p>}
    <p className="its-help">{t('Actualización cada 8 segundos. Los datos vencen a los 15 segundos de su recepción.')}</p>
    {!cameras.length && snapshot && <p className="its-empty">{t(country === 'all' ? 'No hay cámaras de demostración disponibles.' : 'No hay cámaras de demostración para este país. Selecciona Todos los países para ver la prueba.')}</p>}
    {!snapshot && <p className="its-empty">{t('Esperando mediciones del servicio ITS.')}</p>}
    <div className="its-camera-list">{cameras.map(camera => <article key={camera.id} className={`its-camera ${camera.stale ? 'is-stale' : ''}`}>
      <div className="its-camera-heading"><strong>{camera.label}</strong><span className={`its-congestion its-congestion-${camera.congestion}`}>{t(congestionText[camera.congestion])}</span></div>
      {camera.demonstrationLabel && <p className="its-source-label">{camera.demonstrationLabel}</p>}
      <dl className="its-metrics"><div><dt>{t('Velocidad media')}</dt><dd>{camera.speedKmh === null ? '—' : `${fmt(camera.speedKmh, 1)} km/h`}</dd></div><div><dt>{t('Vehículos en la ventana')}</dt><dd>{camera.count === null ? '—' : fmt(camera.count)}</dd></div></dl>
      <p className="its-health">{t('Salud de la cámara')}: <b>{t(healthText[camera.health] || 'No disponible')}</b></p>
      <p className="its-help">{camera.ageSeconds === null ? t('Hora de recepción desconocida') : t('Recibido hace {seconds} s', {seconds: fmt(camera.ageSeconds)})}{' · '}{camera.captureAtMs === null ? t('Captura UTC desconocida') : t('Captura: {time}', {time: date(camera.captureAtMs)})}</p>
      {camera.stale && <p className="its-warning">{t('Observación vencida. La falta de datos no significa tráfico detenido.')}</p>}
      {camera.lanes.length > 0 && <ul className="its-lanes" aria-label={t('Aforo por carril')}>{camera.lanes.map(lane => <li key={lane.id}><span>{lane.id}</span><b>{lane.count === null ? '—' : fmt(lane.count)}</b></li>)}</ul>}
      {itsCoordinates(camera.location) && <button type="button" className="its-focus" onClick={() => onFocusCamera?.(camera)}>{t('Ver cámara en el mapa')}</button>}
      <p className="its-help">{t('Ubicación ilustrativa de una cámara de prueba.')}</p>
    </article>)}</div>
    <div className="its-alert-heading"><h3>{t('Alertas ITS')}</h3><span>{cameras.some(camera => camera.usable) ? fmt(alerts.length) : '—'}</span></div>
    {!alerts.length && cameras.some(camera => camera.usable) && <p className="its-empty">{t('No hay alertas activas en esta prueba. Esto no garantiza que una vía esté libre de incidentes.')}</p>}
    {alerts.map(alert => {
      const camera = cameraById.get(alert.cameraId), observationStale = alert.observationStale || !camera?.usable
        || (alert.kind === 'congestion_observed' && (camera.speedKmh === null || !['denso', 'detenido'].includes(camera.congestion)));
      return <article className="its-alert" key={alert.id}>
        <strong>{t(alert.kind === 'camera_health' ? 'Revisar cámara' : 'Congestión observada')}</strong>
        <p className="its-help">{alert.cameraId}{alert.openedAtMs === null ? '' : ` · ${date(alert.openedAtMs)}`}</p>
        {observationStale && <p className="its-warning">{t('Observación vencida; estado actual desconocido.')}</p>}
        <h4>{t('Observado')}</h4>{alert.observed.map((fact, index) => <p key={index}>{fact.description || t('Observación disponible para revisión.')}{fact.speedKmh !== null && <small>{t('Velocidad observada: {speed} km/h', {speed: fmt(fact.speedKmh, 1)})}</small>}{fact.durationSeconds !== null && <small>{t('Persistencia: {seconds} s', {seconds: fmt(fact.durationSeconds)})}</small>}</p>)}
        <h4>{t('Causa probable')}</h4>{alert.causes.length ? alert.causes.map((cause, index) => <p key={index}>{cause.description || t('Causa no determinada.')}<small>{t('Confianza')}: {t(cause.confidence === 'alto' ? 'Alta' : cause.confidence === 'medio' ? 'Media' : cause.confidence === 'bajo' ? 'Baja' : 'No indicada')}</small></p>) : <p>{t('Causa no determinada.')}</p>}
        {alert.recommendation && <><h4>{t('Acción recomendada')}</h4><p>{alert.recommendation}</p></>}
      </article>;
    })}
    <p className="its-footer-note">{t('Los nombres de cámaras y las descripciones del servicio se muestran en su idioma original.')}</p>
    <a className="its-dashboard-link" href="https://safeorute-its-demo.onrender.com" target="_blank" rel="noopener noreferrer">{t('Abrir dashboard ITS completo')}</a>
  </section>;
}
