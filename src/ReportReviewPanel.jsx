import {useEffect, useRef, useState} from 'react';
import {useI18n} from './LocaleContext';
import {firebaseErrorMessage} from './firebase-errors';
import './report-review-panel.css';

// Authorization belongs to Firestore rules. The parent subscribes to this
// private queue only while the signed-in account has moderator membership.
export default function ReportReviewPanel({reports = [], onReview, loading = false, error = ''}) {
  const {t, language} = useI18n();
  const [processing, setProcessing] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  const pending = Array.isArray(reports)
    ? reports.filter(report => report && typeof report.id === 'string' && report.status === 'pending') : [];
  const externalError = typeof error === 'string' ? error : '';
  const disabled = loading || Boolean(processing) || typeof onReview !== 'function';
  const date = value => {
    const time = Date.parse(value);
    return Number.isFinite(time)
      ? new Intl.DateTimeFormat(language, {dateStyle:'short', timeStyle:'short'}).format(time) : '—';
  };
  const coordinates = report => Number.isFinite(report.lat) && Number.isFinite(report.lng)
    ? `${report.lat.toFixed(3)}, ${report.lng.toFixed(3)}` : '—';

  async function review(id, status) {
    if (disabled) return;
    setProcessing({id, status});
    setReviewError('');
    try {
      await onReview(id, status);
    } catch (cause) {
      if (mounted.current) setReviewError(firebaseErrorMessage(cause, {
        fallback:'No se pudo completar la revisión. Inténtalo de nuevo.',
      }));
    } finally {
      if (mounted.current) setProcessing(null);
    }
  }

  return <section className="report-review-panel" aria-label={t('Reportes pendientes de revisión')}>
    <h2>{t('Reportes pendientes de revisión')}</h2>
    <p className="report-review-intro">{t('Aprobar permite que el reporte aparezca en mapas y rutas de otros usuarios.')}</p>
    {(externalError || reviewError) && <p className="report-review-error" role="alert">{t(externalError || reviewError)}</p>}
    {loading && <p className="report-review-loading" role="status">{t('Cargando reportes pendientes…')}</p>}
    {!loading && !externalError && pending.length === 0 && <p className="report-review-empty" role="status">{t('No hay reportes pendientes.')}</p>}
    <div className="report-review-list">{pending.map(report => <article className="report-review-card" key={report.id}>
      <h3>{t(typeof report.category === 'string' ? report.category : 'Otro')}</h3>
      <p className="report-review-description">{typeof report.description === 'string' ? report.description : '—'}</p>
      <dl>
        <div><dt>{t('Fecha y hora del incidente')}</dt><dd>{date(report.occurredAt)}</dd></div>
        <div><dt>{t('Ubicación aproximada')}</dt><dd dir="ltr">{coordinates(report)}</dd></div>
      </dl>
      <div className="report-review-actions">
        <button type="button" className="primary" disabled={disabled}
          aria-busy={processing?.id === report.id && processing.status === 'approved'}
          onClick={() => review(report.id, 'approved')}>
          {t(processing?.id === report.id && processing.status === 'approved' ? 'Procesando…' : 'Aprobar publicación')}
        </button>
        <button type="button" className="secondary" disabled={disabled}
          aria-busy={processing?.id === report.id && processing.status === 'rejected'}
          onClick={() => review(report.id, 'rejected')}>
          {t(processing?.id === report.id && processing.status === 'rejected' ? 'Procesando…' : 'Rechazar reporte')}
        </button>
      </div>
    </article>)}</div>
  </section>;
}
