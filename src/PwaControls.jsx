import {useEffect, useRef, useState} from 'react';
import {useRegisterSW} from 'virtual:pwa-register/react';
import {useI18n} from './LocaleContext';
import {appRelease} from './release';

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function PwaControls({online, editing, demo}) {
  const {t} = useI18n();
  const [installed, setInstalled] = useState(standalone);
  const [installEvent, setInstallEvent] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState('');
  const [registrationError, setRegistrationError] = useState(false);
  const [cached, setCached] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const detailsRef = useRef(null);
  const editingRef = useRef(editing);
  const registrationRef = useRef(null);
  const reloadStartedRef = useRef(false);
  const lastUpdateCheckRef = useRef(0);
  editingRef.current = editing;

  const {
    offlineReady: [offlineReady],
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration;
      if (registration?.active) {
        setCached(true);
        // Check on every visit, including installed windows left open overnight.
        lastUpdateCheckRef.current = Date.now();
        registration.update().catch(() => {});
      }
    },
    onRegisterError() {
      setRegistrationError(true);
    },
    onNeedReload() {
      // Activation may come from another tab. Reload only through the guarded
      // effect below, never directly from the service worker event.
      setReloadPending(true);
    },
  });

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const onPrompt = event => {
      event.preventDefault();
      setInstallEvent(event);
      setInstallError('');
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      setShowHelp(false);
    };
    const onDisplayChange = () => setInstalled(standalone());
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    displayMode.addEventListener('change', onDisplayChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      displayMode.removeEventListener('change', onDisplayChange);
    };
  }, []);

  useEffect(() => {
    // Also catch controller changes from other tabs/registration timing races.
    // The first installation claiming this page is not an app update.
    if (!('serviceWorker' in navigator)) return;
    let previousController = navigator.serviceWorker.controller;
    const changed = () => {
      const controller = navigator.serviceWorker.controller;
      if (previousController && controller && controller !== previousController) setReloadPending(true);
      previousController = controller;
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', changed);
  }, []);

  useEffect(() => {
    // Recheck on return/reconnection and periodically in long-lived windows.
    // Only visible, online clients check; throttle noisy focus/network events.
    const check = () => {
      setVisible(document.visibilityState === 'visible');
      const registration = registrationRef.current;
      if (!registration || !navigator.onLine || document.visibilityState !== 'visible') return;
      if (Date.now() - lastUpdateCheckRef.current < 60_000) return;
      lastUpdateCheckRef.current = Date.now();
      registration.update().catch(() => {});
    };
    const interval = window.setInterval(check, 5 * 60_000);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  useEffect(() => {
    if (registrationError && detailsRef.current) detailsRef.current.open = true;
  }, [registrationError]);

  useEffect(() => {
    if (!reloadPending || editing || !visible) return;
    // Brief idle delay lets a newly opened task cancel the reload. All update
    // signals share this guard, so one release cannot cause duplicate reloads.
    const timer = window.setTimeout(() => {
      if (editingRef.current || document.visibilityState !== 'visible' || reloadStartedRef.current) return;
      reloadStartedRef.current = true;
      window.location.reload();
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [reloadPending, editing, visible]);

  async function install() {
    setInstallError('');
    if (!installEvent) {
      setShowHelp(value => !value);
      return;
    }
    setInstalling(true);
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch {
      setInstallError('No se pudo abrir la instalación. Usa el menú de tu navegador.');
      setShowHelp(true);
    } finally {
      // A deferred installation event can only be used once, even if dismissed.
      setInstallEvent(null);
      setInstalling(false);
    }
  }

  return <details className="pwa-panel" ref={detailsRef} aria-label={t('Instalación y disponibilidad de SafeRoute')}>
    <summary className="pwa-summary"><strong>{t('Instalar y actualizar')}</strong><span className="pwa-brief">{t(reloadPending ? 'Nueva versión disponible' : online ? 'Con conexión' : 'Sin conexión')}</span></summary>
    <div className="pwa-body">
    <small className="app-release" data-revision={appRelease.revision}>{t('Versión {version}', {version:appRelease.shortRevision})}</small>
    <div className="pwa-summary">
      <div>
        <strong>{t(installed ? 'SafeRoute en tu dispositivo' : 'Lleva SafeRoute contigo')}</strong>
        <p role="status">{!online
          ? [t('Sin conexión.'), t(demo ? 'Tus reportes locales y los ejemplos siguen disponibles.' : 'Puedes abrir la interfaz.'), t('Los mapas, las rutas y los servicios en línea necesitan internet.')].join(' ')
          : registrationError
            ? t('No se pudo preparar el uso sin conexión. Recarga con internet para volver a intentarlo.')
            : offlineReady || cached
              ? t('Interfaz lista para abrir sin conexión. Los mapas y las rutas necesitan internet.')
              : t('Instala la app para abrirla desde tu pantalla de inicio.')}</p>
      </div>
      {!installed && <button type="button" className="secondary" disabled={installing} onClick={install} aria-expanded={showHelp} aria-controls="pwa-install-help">
        {t(installing ? 'Abriendo instalación…' : 'Instalar app')}
      </button>}
    </div>
    {installError && <p role="alert">{t(installError)}</p>}
    {showHelp && <div id="pwa-install-help" className="pwa-help">
      {!window.isSecureContext
        ? <p>{t('Abre SafeRoute desde su dirección HTTPS para instalarla. Una dirección HTTP de la red local solo permite probar el diseño.')}</p>
        : isAppleMobile()
          ? <p>{t('En iPhone o iPad, abre esta página en Safari, toca Compartir y luego Añadir a pantalla de inicio. Confirma con Añadir.')}</p>
          : <p>{t('En Chrome o Edge, abre el menú ⋮ o ⋯ y elige Instalar SafeRoute o Añadir a pantalla de inicio. Si no aparece, usa un navegador compatible y visita la versión HTTPS.')}</p>}
      <button type="button" className="text" onClick={() => setShowHelp(false)}>{t('Cerrar instrucciones')}</button>
    </div>}
    {reloadPending && <div className="pwa-update" role="status">
      <div><strong>{t('Hay una nueva versión de SafeRoute')}</strong>
        <p>{t(editing ? 'La actualización está lista. Se aplicará al terminar esta tarea o al recargar.' : 'Actualizando automáticamente…')}</p>
      </div>
    </div>}
    </div>
  </details>;
}
