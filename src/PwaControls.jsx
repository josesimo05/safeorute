import {useEffect, useRef, useState} from 'react';
import {useRegisterSW} from 'virtual:pwa-register/react';
import {useI18n} from './LocaleContext';

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
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [reloadPending, setReloadPending] = useState(false);
  const detailsRef = useRef(null);
  const editingRef = useRef(editing);
  const registrationRef = useRef(null);
  editingRef.current = editing;

  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration;
      if (registration?.active) setCached(true);
    },
    onRegisterError() {
      setRegistrationError(true);
    },
    onNeedReload() {
      // An update activated in another tab must not discard a report here.
      if (editingRef.current) {
        setReloadPending(true);
        setUpdating(false);
      } else {
        window.location.reload();
      }
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
    // Recheck on return/reconnection so long-lived installed apps find updates.
    const check = () => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        registrationRef.current?.update().catch(() => {});
      }
    };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  useEffect(() => {
    if ((needRefresh || reloadPending || registrationError) && detailsRef.current) detailsRef.current.open = true;
  }, [needRefresh, reloadPending, registrationError]);

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

  async function update() {
    if (editing || !online) return;
    setUpdateError('');
    setUpdating(true);
    try {
      if (reloadPending) window.location.reload();
      else await updateServiceWorker(true);
    } catch {
      setUpdating(false);
      setUpdateError('No se pudo actualizar. Inténtalo de nuevo con conexión.');
    }
  }

  return <details className="pwa-panel" ref={detailsRef} aria-label={t('Instalación y disponibilidad de SafeRoute')}>
    <summary className="pwa-summary"><strong>{t('Instalar y actualizar')}</strong><span className="pwa-brief">{t(needRefresh || reloadPending ? 'Nueva versión disponible' : online ? 'Con conexión' : 'Sin conexión')}</span></summary>
    <div className="pwa-body">
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
    {(needRefresh || reloadPending) && <div className="pwa-update" role="status">
      <div><strong>{t('Hay una nueva versión de SafeRoute')}</strong>
        <p>{t(editing ? 'Termina o cierra el formulario para actualizar sin perder lo que escribiste.' : !online ? 'Vuelve a conectarte para actualizar.' : 'Actualiza cuando quieras. La aplicación se volverá a abrir.')}</p>
        {updateError && <p role="alert">{t(updateError)}</p>}
      </div>
      <button type="button" className="primary" disabled={editing || !online || updating} onClick={update}>{t(updating ? 'Actualizando…' : 'Actualizar ahora')}</button>
    </div>}
    </div>
  </details>;
}
