import {useI18n} from './LocaleContext';
import './report-review-panel.css';

// The parent starts Firebase's provider flow directly from this user gesture.
// This view never receives an OAuth token, password, or account identifier.
export default function GmailSignIn({onLogin, busy = false, disabled = false}) {
  const {t} = useI18n();
  return <div className="gmail-sign-in">
    <button type="button" className="primary gmail-sign-in-button" onClick={onLogin}
      disabled={disabled || busy || typeof onLogin !== 'function'} aria-busy={busy}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </svg>
      <span>{t(busy ? 'Procesando…' : 'Continuar con Gmail')}</span>
    </button>
    <p>{t('Accede con tu cuenta de Gmail. No necesitas crear una contraseña aquí.')}</p>
  </div>;
}
