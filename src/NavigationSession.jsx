import {useEffect, useRef, useState} from 'react';
import {useI18n} from './LocaleContext';
import {routeProgress} from './route-progress';

function locationError(error) {
  if (error?.code === 1) return 'Permite el acceso a tu ubicación para seguir la ruta. Puedes revisar las indicaciones sin GPS.';
  if (error?.code === 3) return 'La ubicación tardó demasiado. Puedes volver a intentarlo.';
  return 'No se pudo obtener tu ubicación. Reintenta al aire libre o revisa los permisos.';
}

function cancelVoice() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

export default function NavigationSession({route, onPosition, onStop, onRecalculate, onFollowChange, onOverview, follow = true, recalculating = false}) {
  const {t, language} = useI18n();
  const [phase, setPhase] = useState('waiting');
  const [gpsError, setGpsError] = useState('');
  const [position, setPosition] = useState(null);
  const [progress, setProgress] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const watch = useRef(null);
  const generation = useRef(0);
  const previous = useRef(null);
  const positionRef = useRef(null);
  const routeRef = useRef(route);
  const callbacks = useRef({onPosition, onFollowChange});
  const announced = useRef(new Set());
  const lastNotice = useRef(null);
  routeRef.current = route;
  callbacks.current = {onPosition, onFollowChange};

  function stopWatch() {
    generation.current++;
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
  }

  useEffect(() => {
    previous.current = null;
    announced.current.clear();
    lastNotice.current = null;
    cancelVoice();
    const next = positionRef.current ? routeProgress(route, positionRef.current) : null;
    previous.current = next;
    setProgress(next);
  }, [route]);

  useEffect(() => {
    const version = ++generation.current;
    setPhase('waiting');
    setGpsError('');
    setPosition(null);
    positionRef.current = null;
    previous.current = null;
    announced.current.clear();
    lastNotice.current = null;
    setProgress(null);
    const unavailable = text => {
      setGpsError(text);
      setPhase('error');
    };
    if (!window.isSecureContext) {
      unavailable('La navegación GPS requiere HTTPS.');
      return;
    }
    if (!navigator.geolocation?.watchPosition) {
      unavailable('Este navegador no ofrece geolocalización. Puedes revisar las indicaciones de la ruta.');
      return;
    }
    const success = fix => {
      if (generation.current !== version) return;
      const {latitude: lat, longitude: lon, accuracy, heading, speed} = fix.coords || {};
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
        failure({code: 2});
        return;
      }
      const current = {
        lat, lon, accuracy,
        heading: Number.isFinite(heading) ? heading : null,
        speed: Number.isFinite(speed) ? speed : null,
      };
      const next = routeProgress(routeRef.current, current, previous.current);
      positionRef.current = current;
      previous.current = next;
      setPosition(current);
      setProgress(next);
      setGpsError('');
      setPhase(next?.arrived ? 'arrived' : 'tracking');
      callbacks.current.onPosition?.(current);
      if (next?.arrived) stopWatch();
    };
    const failure = error => {
      if (generation.current !== version) return;
      stopWatch();
      cancelVoice();
      previous.current = null;
      positionRef.current = null;
      setProgress(null);
      setPosition(null);
      callbacks.current.onPosition?.(null);
      setGpsError(locationError(error));
      setPhase('error');
    };
    try {
      const id = navigator.geolocation.watchPosition(success, failure, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
      // Some browser adapters invoke a callback synchronously before returning an ID.
      if (generation.current === version) watch.current = id;
      else navigator.geolocation.clearWatch(id);
    } catch {
      failure({code: 2});
    }
    return () => {
      stopWatch();
      cancelVoice();
    };
  }, [attempt]);

  const routeIdentity = `${route?.id || ''}:${route?.points?.length || 0}:${route?.points?.[0]?.latitude}:${route?.points?.[0]?.longitude}`;
  const instruction = progress?.instruction;
  const poorAccuracy = progress?.accuratePosition === false || (Number.isFinite(position?.accuracy) && position.accuracy > 50);
  const proximity = Number.isFinite(progress?.distanceToInstruction) && progress.distanceToInstruction <= 40 ? 'near' : 'far';
  const notice = progress?.arrived ? 'arrived' : progress?.offRoute ? 'off-route' : null;
  const maneuver = progress?.arrived ? 'arrived' : progress?.offRoute ? 'off-route'
    : instruction ? `${routeIdentity}:${progress.instructionIndex}:${instruction.text}:${proximity}` : null;
  useEffect(() => {
    if (!voiceEnabled || !maneuver || phase === 'error' || phase === 'waiting' || poorAccuracy) return;
    if (notice) {
      if (lastNotice.current === notice) return;
      lastNotice.current = notice;
    } else {
      lastNotice.current = null;
      if (announced.current.has(maneuver)) return;
      announced.current.add(maneuver);
    }
    cancelVoice();
    const providerInstruction = !notice;
    const text = progress?.arrived ? t('Has llegado al destino.')
      : progress?.offRoute ? t('Te alejaste de la ruta seleccionada.') : instruction.text;
    try {
      // Announce a future turn with its distance. Provider directions can be in
      // another language, so speak the translated prefix separately.
      if (providerInstruction && Number.isFinite(progress.distanceToInstruction) && progress.distanceToInstruction > 15) {
        const prefix = new SpeechSynthesisUtterance(t('{distance} hasta la próxima indicación', {distance: distance(progress.distanceToInstruction)}));
        prefix.lang = language;
        window.speechSynthesis.speak(prefix);
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = providerInstruction ? route.instructionsLanguage || language : language;
      window.speechSynthesis.speak(utterance);
    } catch {
      setVoiceEnabled(false);
      setVoiceError('No se pudo reproducir la indicación de voz.');
    }
  }, [voiceEnabled, maneuver, phase, poorAccuracy, language, route]);

  function distance(value) {
    if (!Number.isFinite(value)) return '—';
    const metres = Math.max(0, value);
    return metres < 1000
      ? t('{distance} m', {distance: new Intl.NumberFormat(language).format(Math.round(metres / 5) * 5)})
      : t('{distance} km', {distance: new Intl.NumberFormat(language, {maximumFractionDigits: 1}).format(metres / 1000)});
  }

  function toggleVoice() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setVoiceError('Tu navegador no ofrece lectura de voz.');
      return;
    }
    setVoiceError('');
    announced.current.clear();
    lastNotice.current = null;
    cancelVoice();
    setVoiceEnabled(value => !value);
  }

  function stop() {
    stopWatch();
    cancelVoice();
    onStop?.();
  }

  function recenter() {
    callbacks.current.onFollowChange?.(true);
    if (positionRef.current) callbacks.current.onPosition?.(positionRef.current);
  }

  const instructions = Array.isArray(route?.instructions) ? route.instructions : [];
  const label = phase === 'waiting' ? t('Buscando tu ubicación…')
    : phase === 'error' ? t('Ubicación no disponible') : phase === 'arrived' ? t('Has llegado al destino.') : t('GPS activo');

  return <section className="guidance-panel" aria-label={t('Navegación en SafeRoute')}>
    <div className="guidance-header"><strong>{t('Navegación en SafeRoute')}</strong><button type="button" onClick={stop}>{t('Detener navegación')}</button></div>
    <p className="guidance-status" role="status">{label}</p>
    {gpsError && <div className="guidance-error"><p>{t(gpsError)}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>{t('Volver a intentar GPS')}</button></div>}
    {poorAccuracy && <p className="guidance-accuracy" role="status">{t('Ubicación poco precisa. Espera una mejor señal antes de seguir las indicaciones.')} {Number.isFinite(position?.accuracy) && t('Precisión GPS: {distance}', {distance: distance(position.accuracy)})}</p>}
    {progress?.arrived ? <div className="guidance-arrived"><strong>{t('Has llegado al destino.')}</strong></div>
      : progress?.offRoute ? <div className="guidance-off-route" role="status"><strong>{t('Te alejaste de la ruta seleccionada.')}</strong><button type="button" disabled={recalculating || poorAccuracy} onClick={() => onRecalculate?.(position)}>{recalculating ? t('Recalculando…') : t('Recalcular desde mi ubicación')}</button></div>
      : instruction && !poorAccuracy ? <div className="guidance-maneuver"><strong dir="auto">{instruction.text}</strong>{Number.isFinite(progress.distanceToInstruction) && <span>{t('{distance} hasta la próxima indicación', {distance: distance(progress.distanceToInstruction)})}</span>}</div>
      : !poorAccuracy && <p className="guidance-empty">{instructions.length ? t('Puedes revisar las indicaciones sin activar el GPS.') : t('No hay indicaciones detalladas para esta ruta.')}</p>}
    <dl className="guidance-metrics"><div><dt>{t('Distancia restante')}</dt><dd>{distance(progress?.remainingDistance ?? route?.distance)}</dd></div><div><dt>{t('Tiempo restante estimado')}</dt><dd>{Number.isFinite(progress?.remainingSeconds ?? route?.seconds) ? t('{minutes} min', {minutes: new Intl.NumberFormat(language).format(Math.ceil((progress?.remainingSeconds ?? route.seconds) / 60))}) : '—'}</dd></div></dl>
    <div className="guidance-actions"><button type="button" aria-pressed={follow} disabled={!position} onClick={recenter}>{follow ? t('Seguir mi ubicación') : t('Volver a centrar')}</button><button type="button" onClick={onOverview}>{t('Ver ruta completa')}</button><button type="button" aria-pressed={voiceEnabled} onClick={toggleVoice}>{voiceEnabled ? t('Voz activada') : t('Activar voz')}</button></div>
    {voiceError && <p className="guidance-error" role="status">{t(voiceError)}</p>}
    {route?.instructionsLanguage === 'en' && ['ar', 'zh'].includes(language) && <p className="guidance-language">{t('Las indicaciones de esta ruta están en inglés.')}</p>}
    <details className="guidance-instructions"><summary>{t('Revisar indicaciones')}</summary>{instructions.length ? <ol>{instructions.map((step, index) => <li key={`${index}-${step.text}`} aria-current={progress?.instructionIndex === index ? 'step' : undefined}><span>{t('Paso {number}', {number: new Intl.NumberFormat(language).format(index + 1)})}</span><strong dir="auto">{step.text}</strong>{Number.isFinite(step.distance) && <small>{distance(step.distance)}</small>}</li>)}</ol> : <p>{t('No hay indicaciones detalladas para esta ruta.')}</p>}</details>
    <p className="guidance-background tiny">{t('El GPS puede detenerse si bloqueas la pantalla o cambias de aplicación.')}</p>
  </section>;
}
