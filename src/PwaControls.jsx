import {useEffect, useRef, useState} from 'react';
import {useRegisterSW} from 'virtual:pwa-register/react';

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isAppleMobile = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function PwaControls({online, editing, demo}) {
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

  return <section className="pwa-panel" aria-label="Instalación y disponibilidad de SafeRoute">
    <div className="pwa-summary">
      <div>
        <strong>{installed ? 'SafeRoute en tu dispositivo' : 'Lleva SafeRoute contigo'}</strong>
        <p role="status">{!online
          ? `Sin conexión. ${demo ? 'Tus reportes locales y los ejemplos siguen disponibles.' : 'Puedes abrir la interfaz.'} Los mapas, las rutas y los servicios en línea necesitan internet.`
          : registrationError
            ? 'No se pudo preparar el uso sin conexión. Recarga con internet para volver a intentarlo.'
            : offlineReady || cached
              ? 'Interfaz lista para abrir sin conexión. Los mapas y las rutas necesitan internet.'
              : 'Instala la app para abrirla desde tu pantalla de inicio.'}</p>
      </div>
      {!installed && <button type="button" className="secondary" disabled={installing} onClick={install} aria-expanded={showHelp} aria-controls="pwa-install-help">
        {installing ? 'Abriendo instalación…' : 'Instalar app'}
      </button>}
    </div>
    {installError && <p role="alert">{installError}</p>}
    {showHelp && <div id="pwa-install-help" className="pwa-help">
      {!window.isSecureContext
        ? <p>Abre SafeRoute desde su dirección HTTPS para instalarla. Una dirección HTTP de la red local solo permite probar el diseño.</p>
        : isAppleMobile()
          ? <p>En iPhone o iPad, abre esta página en Safari, toca <strong>Compartir</strong> y luego <strong>Añadir a pantalla de inicio</strong>. Confirma con <strong>Añadir</strong>.</p>
          : <p>En Chrome o Edge, abre el menú <strong>⋮</strong> o <strong>⋯</strong> y elige <strong>Instalar SafeRoute</strong> o <strong>Añadir a pantalla de inicio</strong>. Si no aparece, usa un navegador compatible y visita la versión HTTPS.</p>}
      <button type="button" className="text" onClick={() => setShowHelp(false)}>Cerrar instrucciones</button>
    </div>}
    {(needRefresh || reloadPending) && <div className="pwa-update" role="status">
      <div><strong>Hay una nueva versión de SafeRoute</strong>
        <p>{editing ? 'Termina o cierra el formulario para actualizar sin perder lo que escribiste.' : !online ? 'Vuelve a conectarte para actualizar.' : 'Actualiza cuando quieras. La aplicación se volverá a abrir.'}</p>
        {updateError && <p role="alert">{updateError}</p>}
      </div>
      <button type="button" className="primary" disabled={editing || !online || updating} onClick={update}>{updating ? 'Actualizando…' : 'Actualizar ahora'}</button>
    </div>}
  </section>;
}
