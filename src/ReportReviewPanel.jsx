import {useEffect, useId, useRef, useState} from 'react';
import {useI18n} from './LocaleContext';
import {firebaseErrorMessage} from './firebase-errors';
import './report-review-panel.css';

// Authorization belongs to Firestore rules. The parent subscribes to this
// private queue only while the signed-in account has moderator membership.
export default function ReportReviewPanel({reports = [], onReview, approvedReports = [], onWithdraw, loading = false, error = ''}) {
  const {t, language} = useI18n();
  const [processing, setProcessing] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [withdrawalError, setWithdrawalError] = useState('');
  const [confirmationId, setConfirmationId] = useState(null);
  const mounted = useRef(true);
  const processingRef = useRef(false);
  const confirmationRegionId = useId();
  const confirmationDescriptionId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);
  useEffect(() => {
    if (confirmationId && !(Array.isArray(approvedReports) && approvedReports.some(report =>
      report?.id === confirmationId && report.status === 'approved'))) {
      setConfirmationId(null);
      setWithdrawalError('');
    }
  }, [approvedReports, confirmationId]);

  const pending = Array.isArray(reports)
    ? reports.filter(report => report && typeof report.id === 'string' && report.status === 'pending') : [];
  const published = Array.isArray(approvedReports)
    ? approvedReports.filter(report => report && typeof report.id === 'string' && report.status === 'approved') : [];
  const externalError = typeof error === 'string' ? error : '';
  const disabled = loading || Boolean(processing) || typeof onReview !== 'function';
  const withdrawalDisabled = Boolean(processing) || typeof onWithdraw !== 'function';
  const date = value => {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(time)
      ? new Intl.DateTimeFormat(language, {dateStyle:'short', timeStyle:'short'}).format(time) : '—';
  };
  const coordinates = report => Number.isFinite(report.lat) && Number.isFinite(report.lng)
    ? `${report.lat.toFixed(3)}, ${report.lng.toFixed(3)}` : '—';

  async function review(id, status) {
    if (disabled || processingRef.current) return;
    processingRef.current = true;
    setProcessing({id, status});
    setReviewError('');
    try {
      await onReview(id, status);
    } catch (cause) {
      if (mounted.current) setReviewError(firebaseErrorMessage(cause, {
        moderation:true,
        fallback:'No se pudo completar la revisión. Inténtalo de nuevo.',
      }));
    } finally {
      processingRef.current = false;
      if (mounted.current) setProcessing(null);
    }
  }

  async function withdraw(id) {
    if (withdrawalDisabled || processingRef.current || confirmationId !== id ||
      !published.some(report => report.id === id)) return;
    processingRef.current = true;
    setProcessing({id, status:'withdrawn'});
    setWithdrawalError('');
    try {
      await onWithdraw(id);
      if (mounted.current) setConfirmationId(null);
    } catch (cause) {
      if (mounted.current) setWithdrawalError(firebaseErrorMessage(cause, {
        moderation:true,
        fallback:'No se pudo retirar el reporte. Inténtalo de nuevo.',
      }));
    } finally {
      processingRef.current = false;
      if (mounted.current) setProcessing(null);
    }
  }

  return <div className="report-review-panel"><section aria-label={t('Reportes pendientes de revisión')}>
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
  </section><section className="published-reports" aria-label={t('Reportes publicados')}>
    <h2>{t('Reportes publicados')}</h2>
    <p className="report-review-intro">{t('Puedes retirar un reporte aprobado para que deje de aparecer a los usuarios.')}</p>
    {withdrawalError && <p className="report-review-error" role="alert">{t(withdrawalError)}</p>}
    {published.length === 0 && <p className="report-review-empty" role="status">{t('No hay reportes publicados.')}</p>}
    <div className="report-review-list">{published.map(report => <article className="report-review-card published-report-card" key={report.id}>
      <h3>{t(typeof report.category === 'string' ? report.category : 'Otro')}</h3>
      <p className="report-review-description">{typeof report.description === 'string' ? report.description : '—'}</p>
      <dl>
        <div><dt>{t('Fecha y hora del incidente')}</dt><dd>{date(report.occurredAt)}</dd></div>
        <div><dt>{t('Ubicación aproximada')}</dt><dd dir="ltr">{coordinates(report)}</dd></div>
      </dl>
      <div className="report-review-actions">
        <button type="button" className="withdraw-report-button" disabled={withdrawalDisabled}
          aria-expanded={confirmationId === report.id}
          aria-controls={confirmationId === report.id ? confirmationRegionId : undefined}
          onClick={() => {
            if (processingRef.current) return;
            setConfirmationId(report.id);setWithdrawalError('');
          }}>{t('Retirar reporte')}</button>
      </div>
      {confirmationId === report.id && <div className="report-withdraw-confirmation" id={confirmationRegionId}
        role="group" aria-label={t('Confirmar retirada')} aria-describedby={confirmationDescriptionId}>
        <p id={confirmationDescriptionId}>{t('El reporte dejará de aparecer en mapas y rutas. Se conservará el historial privado.')}</p>
        <div className="report-review-actions">
          <button type="button" className="withdraw-report-button" disabled={withdrawalDisabled}
            aria-busy={processing?.id === report.id && processing.status === 'withdrawn'}
            onClick={() => withdraw(report.id)}>
            {t(processing?.id === report.id && processing.status === 'withdrawn' ? 'Procesando…' : 'Confirmar retirada')}
          </button>
          <button type="button" disabled={Boolean(processing)} onClick={() => {
            if (processingRef.current) return;
            setConfirmationId(null);setWithdrawalError('');
          }}>{t('Cancelar')}</button>
        </div>
      </div>}
    </article>)}</div>
  </section></div>;
}
