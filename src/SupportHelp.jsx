import {useEffect, useMemo, useRef, useState} from 'react';
import {useI18n} from './LocaleContext';
import {getSupportArticles, safeSupportContactUrl} from './support-content';
import './support.css';

const errorText = {
  SUPPORT_NOT_CONFIGURED: 'La IA de ayuda no está disponible. Puedes consultar las preguntas frecuentes sin conexión.',
  SUPPORT_AUTH_REQUIRED: 'No se pudo autorizar la consulta de IA. Inténtalo de nuevo más tarde.',
  SUPPORT_AUTH_UNAVAILABLE: 'No se pudo autorizar la consulta de IA. Inténtalo de nuevo más tarde.',
  SUPPORT_RATE_LIMIT: 'Has alcanzado el límite de consultas. Espera antes de volver a intentarlo.',
  SUPPORT_UNAVAILABLE: 'El servicio de IA no respondió. Prueba de nuevo más tarde.',
  SUPPORT_NETWORK_ERROR: 'No se pudo conectar con la IA. Comprueba tu conexión.',
  SUPPORT_INVALID_REQUEST: 'Revisa tu pregunta. Debe tener entre 1 y 1200 caracteres.',
  OFFLINE: 'La IA necesita conexión a Internet. Las preguntas frecuentes siguen disponibles.',
};
const searchKey = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export default function SupportHelp({open = false, onClose, askAssistant, contactUrl = ''}) {
  const {t, language} = useI18n();
  const [search, setSearch] = useState('');
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [copyState, setCopyState] = useState('');
  const [manualCopy, setManualCopy] = useState('');
  const [online, setOnline] = useState(isOnline);
  const [articleTarget, setArticleTarget] = useState(null);
  const dialog = useRef(null), closeButton = useRef(null), articleNodes = useRef(new Map());
  const currentRequest = useRef(null), generation = useRef(0), openRef = useRef(open), closeCallback = useRef(onClose);
  openRef.current = open; closeCallback.current = onClose;
  const articles = useMemo(() => getSupportArticles(language), [language]);
  const articlesById = useMemo(() => new Map(articles.map(article => [article.id, article])), [articles]);
  const contact = useMemo(() => safeSupportContactUrl(contactUrl), [contactUrl]);
  const query = searchKey(search.trim());
  const visibleArticles = useMemo(() => articles.filter(article => !query || searchKey(`${article.question} ${article.answer}`).includes(query)), [articles, query]);

  function cancelRequest() {
    generation.current++;
    currentRequest.current?.abort();
    currentRequest.current = null;
  }
  function clearConversation() {
    cancelRequest(); setTurns([]); setQuestion(''); setBusy(false); setErrorCode(''); setCopyState(''); setManualCopy('');
  }
  function closeHelp() {
    clearConversation(); setSearch(''); setArticleTarget(null);
    closeCallback.current?.();
  }

  useEffect(() => {
    const net = () => setOnline(isOnline());
    window.addEventListener('online', net); window.addEventListener('offline', net);
    return () => {window.removeEventListener('online', net); window.removeEventListener('offline', net); cancelRequest();};
  }, []);
  useEffect(() => {
    if (!open) {clearConversation(); setSearch(''); setArticleTarget(null); return;}
    const previousFocus = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const focusable = () => Array.from(dialog.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]') || [])
      .filter(node => !node.hidden && node.getClientRects().length > 0);
    const keydown = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeHelp();
      } else if (event.key === 'Tab') {
        const nodes = focusable(), first = nodes[0], last = nodes[nodes.length - 1];
        if (!first) {event.preventDefault(); dialog.current?.focus(); return;}
        if (!dialog.current?.contains(document.activeElement)) {event.preventDefault(); first.focus();}
        else if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      cancelRequest();
      document.removeEventListener('keydown', keydown, true);
      document.body.style.overflow = oldOverflow;
      if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open || !articleTarget) return;
    const detail = articleNodes.current.get(articleTarget.id);
    if (detail) {detail.open = true; detail.querySelector('summary')?.focus(); detail.scrollIntoView({block:'nearest'});}
  }, [articleTarget, search, open]);

  async function sendQuestion(event) {
    event.preventDefault();
    if (busy) return;
    const message = question.trim();
    setCopyState(''); setManualCopy('');
    if (!message || message.length > 1200) {setErrorCode('SUPPORT_INVALID_REQUEST'); return;}
    if (!isOnline()) {setErrorCode('OFFLINE'); return;}
    if (typeof askAssistant !== 'function') {setErrorCode('SUPPORT_NOT_CONFIGURED'); return;}
    cancelRequest();
    const version = generation.current;
    const controller = new AbortController();
    currentRequest.current = controller;
    const turnId = `support-${version}`;
    setErrorCode(''); setBusy(true); setQuestion('');
    setTurns(previous => [...previous.slice(-5), {id:turnId, question:message, answer:null, sourceIds:[], needsHuman:false}]);
    try {
      // Only this question and the chosen language leave the page. The chat,
      // community reports and GPS never form part of this request.
      const response = await askAssistant({message, language, signal:controller.signal});
      if (!openRef.current || generation.current !== version || controller.signal.aborted) return;
      if (typeof response?.answer !== 'string' || !response.answer.trim() || response.answer.length > 1200) {
        const error = new Error(); error.code = 'SUPPORT_UNAVAILABLE'; throw error;
      }
      const sourceIds = [...new Set(Array.isArray(response.sourceIds) ? response.sourceIds : [])]
        .filter(id => typeof id === 'string' && articlesById.has(id)).slice(0, 8);
      setTurns(previous => previous.map(turn => turn.id === turnId
        ? {...turn, answer:response.answer.trim(), sourceIds, needsHuman:response.needsHuman === true} : turn));
    } catch (error) {
      if (!openRef.current || generation.current !== version || controller.signal.aborted || error?.name === 'AbortError') return;
      setErrorCode(Object.hasOwn(errorText, error?.code) ? error.code : 'SUPPORT_UNAVAILABLE');
      setQuestion(current => current || message);
    } finally {
      if (generation.current === version) {currentRequest.current = null; setBusy(false);}
    }
  }
  function revealArticle(id) {setSearch(''); setArticleTarget({id});}
  const latest = turns[turns.length - 1];
  function shareSummary() {
    const prompt = latest?.question || question.trim();
    if (!prompt) return '';
    const parts = [t('Consulta SafeRoute'), `${t('Pregunta')}: ${prompt}`,
      `${t('Respuesta de IA')}: ${latest?.answer || t('Sin respuesta de IA.')}`];
    const sources = (latest?.sourceIds || []).map(id => articlesById.get(id)?.question).filter(Boolean);
    if (sources.length) parts.push(`${t('Fuentes de ayuda')}: ${sources.join(' · ')}`);
    return parts.join('\n\n');
  }
  async function copySummary() {
    const summary = shareSummary();
    if (!summary) return;
    setCopyState('');
    try {
      if (!navigator.clipboard?.writeText || !window.isSecureContext) throw new Error();
      await navigator.clipboard.writeText(summary);
      if (openRef.current) {setCopyState('copied'); setManualCopy('');}
    } catch {
      if (openRef.current) {setCopyState('manual'); setManualCopy(summary);}
    }
  }
  if (!open) return null;
  return <div className="support-overlay">
    <section className="support-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="support-title" tabIndex={-1}>
      <div className="support-heading"><div><span className="eyebrow">SafeRoute</span><h2 id="support-title">{t('Ayuda y soporte')}</h2></div><button ref={closeButton} type="button" className="support-close" aria-label={t('Cerrar ayuda')} onClick={closeHelp}>×</button></div>
      <p className="support-intro">{t('Solo para dudas sobre SafeRoute. No atiende emergencias ni confirma incidentes.')}</p>
      <div className="support-faq">
        <div className="support-section-heading"><h3>{t('Preguntas frecuentes')}</h3><span>{t('Respuestas incluidas · sin conexión')}</span></div>
        <label htmlFor="support-search">{t('Buscar en la ayuda')}<input id="support-search" type="search" maxLength={120} value={search} onChange={event=>setSearch(event.target.value)} placeholder={t('Por ejemplo: instalar, GPS, reportes…')} /></label>
        <div className="support-articles">{visibleArticles.map(article => <details key={article.id} ref={node => {if (node) articleNodes.current.set(article.id, node); else articleNodes.current.delete(article.id);}} id={`support-article-${article.id}`}><summary>{article.question}</summary><p>{article.answer}</p></details>)}</div>
        {!visibleArticles.length && <p className="support-note" role="status">{t('No hay preguntas que coincidan. Prueba otra palabra.')}</p>}
      </div>
      <div className="support-assistant">
        <div className="support-section-heading"><h3>{t('Asistente de ayuda')}</h3>{turns.length > 0 && <button type="button" onClick={clearConversation}>{t('Borrar conversación')}</button>}</div>
        <p className="support-note">{t('Tu pregunta se envía al proveedor de IA. No se adjuntan automáticamente tus reportes, ubicación ni conversaciones anteriores.')}</p>
        <p className="support-note">{t('No incluyas contraseñas, teléfonos, correos ni otros datos personales.')}</p>
        {!online && <p className="support-warning" role="status">{t(errorText.OFFLINE)}</p>}
        {turns.length > 0 && <div className="support-conversation" role="log" aria-label={t('Conversación de ayuda')} aria-live="polite" aria-relevant="additions text">{turns.map(turn => <article className="support-turn" key={turn.id}>
          <div className="support-question"><b>{t('Tú')}</b><p>{turn.question}</p></div>
          {turn.answer && <div className="support-answer"><b>{t('Respuesta de IA')}</b><p>{turn.answer}</p>{turn.sourceIds.length > 0 && <div className="support-sources"><span>{t('Fuentes de ayuda')}</span>{turn.sourceIds.map(id => <button type="button" key={id} onClick={()=>revealArticle(id)}>{articlesById.get(id)?.question}</button>)}</div>}{turn.needsHuman && <p className="support-needs-human">{t('Puedes copiar tu consulta y compartirla con quien te ayude. La app no la envía automáticamente.')}</p>}</div>}
        </article>)}</div>}
        <form onSubmit={sendQuestion}>
          <label htmlFor="support-question">{t('Tu pregunta')}<textarea id="support-question" value={question} maxLength={1200} onChange={event=>setQuestion(event.target.value)} placeholder={t('Escribe tu duda sobre la aplicación…')} aria-describedby="support-count support-privacy" /></label>
          <div className="support-form-actions"><small id="support-count">{t('{count} de 1200 caracteres', {count:new Intl.NumberFormat(language).format(question.length)})}</small><button type="submit" className="primary" disabled={busy || !question.trim()}>{busy ? t('Consultando…') : t('Preguntar a la IA')}</button></div>
        </form>
        {busy && <p className="support-note" role="status">{t('Consultando…')}</p>}
        {errorCode && <p className="support-warning" role="alert">{t(errorText[errorCode] || errorText.SUPPORT_UNAVAILABLE)}</p>}
        <p id="support-privacy" className="support-note">{t('El historial de esta ventana se borra al cerrar la ayuda.')}</p>
        {turns.some(turn=>turn.answer) && <p className="support-note">{t('Estas respuestas pueden contener errores. Revisa las preguntas frecuentes y la información del proyecto.')}</p>}
      </div>
      <div className="support-share">
        <p>{t('Puedes copiar tu consulta y compartirla con quien te ayude. La app no la envía automáticamente.')}</p>
        {latest && <p>{t('Se copiará la última consulta y su respuesta, si existe.')}</p>}
        <div className="support-share-actions"><button type="button" onClick={copySummary} disabled={!latest?.question && !question.trim()}>{t('Copiar consulta')}</button>{contact && <a href={contact} target="_blank" rel="noopener noreferrer">{t('Contactar soporte')}</a>}</div>
        {copyState === 'copied' && <p role="status">{t('Consulta copiada.')}</p>}
        {copyState === 'manual' && <p role="status">{t('No se pudo copiar automáticamente. Selecciona el texto para copiarlo.')}</p>}
        {manualCopy && <label>{t('Consulta para compartir')}<textarea className="support-copy" readOnly value={manualCopy} onFocus={event=>event.target.select()} /></label>}
      </div>
    </section>
  </div>;
}
