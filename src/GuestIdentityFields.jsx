import {useCallback, useEffect, useMemo, useState} from 'react';
import {useI18n} from './LocaleContext';
import {fetchGuestIdentityConfig} from './guest-identity-client';

/** Config only: the number itself remains in the open report form's memory. */
export function useGuestIdentityConfig({enabled, online}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const request = useMemo(() => ({enabled, online, attempt}), [enabled, online, attempt]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!request.enabled || !request.online) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    fetchGuestIdentityConfig({signal: controller.signal}).then(required => {
      if (active) setResult({request, status: required ? 'required' : 'off'});
    }).catch(() => {
      if (active) setResult({request, status: 'unavailable'});
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [request]);

  // A previous false must never silently allow legacy submission on a new open,
  // retry, or reconnection while the current server policy is still unknown.
  const status = !enabled ? 'off' : !online ? 'unavailable'
    : result?.request === request ? result.status : 'loading';
  return {status, retry};
}

export default function GuestIdentityFields({status, cedula, onChange, onRetry}) {
  const {t} = useI18n();
  if (status === 'off') return null;
  if (status === 'loading') return <p className="guest-identity-status" role="status">{t('Comprobando opciones de reporte…')}</p>;
  if (status !== 'required') return <div className="guest-identity-status" role="alert">
    <p>{t('No pudimos comprobar el envío con cédula. Reintenta antes de enviar.')}</p>
    <button type="button" onClick={onRetry}>{t('Reintentar comprobación')}</button>
  </div>;

  return <div className="guest-identity-fields">
    <label htmlFor="guest-report-identity">{t('Cédula (solo para este envío)')}
      <input id="guest-report-identity" name="guest-identity" type="text" inputMode="numeric"
        autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={20} required
        aria-describedby="guest-report-identity-help" value={cedula}
        onChange={event => onChange(event.target.value)} />
    </label>
    <p id="guest-report-identity-help" className="tiny">{t('Solo se guarda una huella protegida para limitar reportes repetidos. El número no se publica ni se conserva. No verifica tu identidad.')}</p>
  </div>;
}
