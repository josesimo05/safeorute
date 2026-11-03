import React, {useEffect, useMemo, useState} from 'react';
import {createPilotState, DEMO_PROFILES, CASE_STATES, visibleCases, visibleNotices,
  applyPilotAction, canManage, publicDemoNotices} from './pilot-model';
import MapScheme from './MapScheme';

const tabs = [{name:'Resumen', icon:'overview'}, {name:'Reportes', icon:'reports'}, {name:'Avisos', icon:'notices'}, {name:'Cámaras', icon:'cameras'}, {name:'Historial', icon:'history'}];
const noticeLabels = {draft:'Borrador', submitted:'En revisión', approved:'Aprobado', published:'Publicado en simulación', retracted:'Retirado'};
const stateLabel = value => CASE_STATES.find(state => state.value === value)?.label || value;
const dateLabel = value => new Intl.DateTimeFormat('es-DO', {dateStyle:'short', timeStyle:'short'}).format(new Date(value));
const localInput = value => {const date = new Date(value); return new Date(date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);};
const confidenceLabel = value => ({alto:'Alta', medio:'Media', bajo:'Baja'})[value] || 'Sin determinar';
const institutionLabel = value => value === 'PN' ? 'Policía Nacional' : value === 'DIGESETT' ? 'DIGESETT' : 'Todas las vistas';

function Icon({name}) {
  const paths = {
    overview:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    reports:<><path d="M8 4h12v16H4V8z"/><path d="M8 4v4H4M8 12h8M8 16h6"/></>,
    notices:<><path d="m4 9 14-5v16L4 15zM4 9H2v6h2M6 16l2 5h3l-2-4M21 8v8"/></>,
    cameras:<><rect x="3" y="7" width="13" height="11" rx="2"/><path d="m16 10 5-3v12l-5-3M7 4h5"/></>,
    history:<><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.reports}</svg>;
}

function CaseDetail({item, profile, onAction}) {
  const [nextState, setNextState] = useState(item.state);
  const [assignedTo, setAssignedTo] = useState(item.assignedTo);
  const [note, setNote] = useState('');
  useEffect(() => {setNextState(item.state);setAssignedTo(item.assignedTo);setNote('');}, [item.id, item.version, profile.id]);
  const editable = canManage(profile);
  return <section className="pilot-case-detail" aria-label={`Detalle del caso ${item.id}`}>
    <div className="pilot-detail-top"><span className="pilot-overline">{item.id}</span><span className={`pilot-priority priority-${item.priority}`}>Prioridad {item.priority}</span></div>
    <h2>{item.title}</h2><div className="pilot-detail-meta"><span>{item.institutions.join(' + ')}</span><span>{stateLabel(item.state)}</span></div>
    <p className="pilot-muted">{item.zone} · {dateLabel(item.reportedAt)}<br/>Fuente: reporte o medición ficticia del piloto.</p>
    <div className="pilot-evidence"><h3>Observado</h3><ul>{item.observed.map((fact, index) => <li key={index}>{fact}</li>)}</ul></div>
    <div className="pilot-hypothesis"><h3>Causa probable</h3><p>{item.probableCause}</p><span className={`pilot-confidence confidence-${item.confidence}`}>Confianza {confidenceLabel(item.confidence).toLowerCase()}</span><p className="pilot-small">{item.confidenceReason}</p></div>
    <p className="pilot-coordinates">Ubicación simulada: {item.lat.toFixed(3)}, {item.lng.toFixed(3)}</p>
    {editable ? <form className="pilot-case-form" onSubmit={event => {event.preventDefault();onAction({type:'CASE_UPDATE', caseId:item.id, expectedVersion:item.version, patch:{state:nextState, assignedTo}});}}>
      <div className="pilot-field-row"><label>Estado del caso<select value={nextState} onChange={event => setNextState(event.target.value)}>{CASE_STATES.map(state => <option key={state.value} value={state.value}>{state.label}</option>)}</select></label><label>Responsable de prueba<input maxLength={80} value={assignedTo} onChange={event => setAssignedTo(event.target.value)} /></label></div>
      <button type="submit" className="pilot-button pilot-button-secondary">Guardar gestión simulada</button>
    </form> : <p className="pilot-readonly">Esta vista es de consulta. Cambia el perfil de demostración para probar la gestión.</p>}
    <div className="pilot-notes"><h3>Notas internas de prueba</h3>{item.notes.length ? item.notes.map(entry => <article key={entry.id}><p>{entry.text}</p><small>{entry.authorName} · {dateLabel(entry.createdAt)}</small></article>) : <p className="pilot-muted">Este caso todavía no tiene notas.</p>}
      {editable && <form onSubmit={event => {event.preventDefault();if(onAction({type:'CASE_NOTE', caseId:item.id, text:note}))setNote('');}}><label>Nota interna de prueba<textarea value={note} maxLength={600} required onChange={event => setNote(event.target.value)} placeholder="Escribe solo ejemplos ficticios…" /></label><button className="pilot-button pilot-button-secondary" type="submit">Añadir nota de prueba</button></form>}
    </div>
  </section>;
}

function NoticeComposer({onCreate, profile}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [zone, setZone] = useState('Santo Domingo · zona de prueba');
  const [validUntil, setValidUntil] = useState(() => localInput(Date.now() + 90 * 60000));
  return <form className="pilot-notice-compose" onSubmit={event => {event.preventDefault();if(onCreate({type:'NOTICE_CREATE', title, text, zone, institution:profile.institution, validUntil:new Date(validUntil).toISOString()})){setTitle('');setText('');}}}>
    <div className="pilot-section-heading"><div><span className="pilot-overline">COMUNICACIÓN A CIUDADANOS</span><h2>Preparar aviso de prueba</h2></div><span className="pilot-subtle-tag">Solo simulación</span></div>
    <label>Título del aviso<input value={title} onChange={event => setTitle(event.target.value)} required minLength={5} maxLength={100} placeholder="Ej. Desvío temporal por obstrucción" /></label>
    <label>Mensaje para ciudadanos<textarea value={text} onChange={event => setText(event.target.value)} required minLength={12} maxLength={600} placeholder="Describe lo observado, la recomendación y la vigencia. Usa datos ficticios." /></label>
    <div className="pilot-field-row"><label>Zona del aviso<input value={zone} onChange={event => setZone(event.target.value)} required maxLength={80} /></label><label>Vigencia del aviso<input type="datetime-local" value={validUntil} onChange={event => setValidUntil(event.target.value)} required /></label></div>
    <button type="submit" className="pilot-button pilot-button-primary">Crear borrador</button>
    <p className="pilot-small">Otra persona con perfil de supervisor deberá aprobar la versión antes de publicarla en esta simulación.</p>
  </form>;
}

function NoticeDetail({notice, profile, onAction}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(notice.title);
  const [text, setText] = useState(notice.text);
  const [zone, setZone] = useState(notice.zone);
  const [validUntil, setValidUntil] = useState(() => localInput(notice.validUntil));
  const [reason, setReason] = useState('');
  useEffect(() => {setEditing(false);setTitle(notice.title);setText(notice.text);setZone(notice.zone);setValidUntil(localInput(notice.validUntil));setReason('');}, [notice.id, notice.version, profile.id]);
  const author = notice.authorId === profile.id;
  const supervisor = profile.role === 'supervisor';
  const editable = author && canManage(profile) && ['draft','submitted','approved'].includes(notice.status);
  return <section className="pilot-notice-detail" aria-label={`Detalle del aviso ${notice.id}`}>
    <div className="pilot-section-heading"><span className="pilot-overline">{notice.id}</span><span className={`pilot-status notice-${notice.status}`}>{noticeLabels[notice.status]}</span></div>
    <h2>{notice.title}</h2><p className="pilot-notice-copy">{notice.text}</p><p className="pilot-small">{institutionLabel(notice.institution)} · {notice.zone}<br/>Autor de prueba: {notice.authorName}<br/>Vigente hasta {dateLabel(notice.validUntil)} · Versión {notice.version}</p>
    {notice.approvedBy && <p className="pilot-approval">Versión aprobada: {notice.approvedVersion} · Revisor: {DEMO_PROFILES.find(value => value.id === notice.approvedBy)?.name || notice.approvedBy}</p>}
    <div className="pilot-action-row">
      {editable && <button type="button" className="pilot-button pilot-button-secondary" onClick={() => setEditing(value => !value)}>{editing ? 'Cancelar edición' : 'Editar borrador'}</button>}
      {author && notice.status === 'draft' && <button type="button" className="pilot-button pilot-button-primary" onClick={() => onAction({type:'NOTICE_SUBMIT', noticeId:notice.id, expectedVersion:notice.version})}>Enviar a revisión</button>}
      {supervisor && notice.status === 'submitted' && <button type="button" className="pilot-button pilot-button-primary" onClick={() => onAction({type:'NOTICE_APPROVE', noticeId:notice.id, expectedVersion:notice.version})}>Aprobar versión</button>}
      {supervisor && notice.status === 'approved' && <button type="button" className="pilot-button pilot-button-primary" onClick={() => onAction({type:'NOTICE_PUBLISH', noticeId:notice.id, expectedVersion:notice.version})}>Publicar simulación</button>}
    </div>
    {notice.status === 'submitted' && <p className="pilot-review-tip">Prueba la revisión cambiando a un supervisor de la misma institución. El autor no puede aprobar su propio aviso.</p>}
    {editing && <form className="pilot-edit-form" onSubmit={event => {event.preventDefault();onAction({type:'NOTICE_EDIT',noticeId:notice.id,expectedVersion:notice.version,patch:{title,text,zone,validUntil:new Date(validUntil).toISOString()}});}}><label>Editar título<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={100}/></label><label>Editar mensaje<textarea value={text} onChange={event => setText(event.target.value)} required maxLength={600}/></label><label>Editar zona<input value={zone} onChange={event => setZone(event.target.value)} required maxLength={80}/></label><label>Editar vigencia<input type="datetime-local" value={validUntil} onChange={event => setValidUntil(event.target.value)} required/></label><button type="submit" className="pilot-button pilot-button-primary">Guardar nueva versión</button><p className="pilot-small">Cambiar el aviso invalida su revisión anterior.</p></form>}
    {supervisor && notice.status === 'published' && <form className="pilot-retract-form" onSubmit={event => {event.preventDefault();onAction({type:'NOTICE_RETRACT',noticeId:notice.id,reason,expectedVersion:notice.version});}}><label>Motivo del retiro<input value={reason} onChange={event => setReason(event.target.value)} required minLength={5} maxLength={300} placeholder="Ej. El incidente de prueba ya fue resuelto"/></label><button type="submit" className="pilot-button pilot-button-danger">Retirar aviso</button></form>}
    <p className="pilot-simulation-footnote">Los cambios de este aviso solo afectan esta demostración; no se envían a ciudadanos.</p>
  </section>;
}

export default function PilotApp() {
  const [data, setData] = useState(() => createPilotState());
  const [profileId, setProfileId] = useState('op-pn');
  const [tab, setTab] = useState('Resumen');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [selectedNoticeId, setSelectedNoticeId] = useState(null);
  const [message, setMessage] = useState(null);
  const profile = DEMO_PROFILES.find(value => value.id === profileId) || DEMO_PROFILES[0];
  const cases = useMemo(() => visibleCases(data, profile), [data, profile]);
  const notices = useMemo(() => visibleNotices(data, profile), [data, profile]);
  const filtered = cases.filter(item => (!query.trim() || `${item.id} ${item.title} ${item.category} ${item.zone}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'))) && (filter === 'all' ? true : filter === 'active' ? !['resolved','discarded'].includes(item.state) : filter === 'pending' ? ['new','reviewing'].includes(item.state) : filter === 'high' ? item.priority === 'alta' : item.state === filter));
  const selectedCase = (tab === 'Reportes' ? filtered : cases).find(item => item.id === selectedCaseId) || (tab === 'Reportes' ? filtered : cases)[0];
  const selectedNotice = notices.find(item => item.id === selectedNoticeId) || notices[0];
  const publicNotices = publicDemoNotices(data);
  const activeCount = cases.filter(item => !['resolved','discarded'].includes(item.state)).length;
  const pendingCount = cases.filter(item => ['new','reviewing'].includes(item.state)).length;
  const highCount = cases.filter(item => item.priority === 'alta' && !['resolved','discarded'].includes(item.state)).length;
  const onlineCameras = data.cameras.filter(item => item.health === 'online').length;
  function onAction(action) {
    try {
      const next = applyPilotAction(data, action, profile);
      setData(next);
      if (action.type === 'NOTICE_CREATE') {
        setSelectedNoticeId(next.notices.find(item => !data.notices.some(previous => previous.id === item.id))?.id || null);
      }
      setMessage({kind:'success',text:action.type === 'NOTICE_PUBLISH' ? 'Aviso publicado solo en la simulación. No se envió a usuarios de SafeRoute.' : action.type === 'NOTICE_RETRACT' ? 'Aviso retirado de la vista ciudadana simulada.' : 'Cambio guardado en esta simulación.'});
      return true;
    } catch (error) {setMessage({kind:'error',text:error.message || 'No se pudo realizar el cambio de prueba.'});return false;}
  }
  function resetDemo() {setData(createPilotState());setSelectedCaseId(null);setSelectedNoticeId(null);setQuery('');setFilter('all');setMessage({kind:'success',text:'La demostración volvió a sus datos iniciales.'});}
  function openReports(nextFilter = 'all') {setFilter(nextFilter);setQuery('');setTab('Reportes');}
  return <div className="authority-pilot">
    <aside className="pilot-sidebar"><a className="pilot-brand" href="/piloto/"><img src="/brand-mark.png" width="34" height="42" alt=""/><span>SafeRoute<small>CENTRO DE OPERACIONES</small></span></a><div className="pilot-workspace-label">PILOTO CONJUNTO</div><div className="pilot-institutions"><span>PN</span><span>DIGESETT</span></div>
      <nav aria-label="Secciones del piloto">{tabs.map(item => <button type="button" key={item.name} className={tab === item.name ? 'is-active' : ''} aria-current={tab === item.name ? 'page' : undefined} onClick={() => setTab(item.name)}><Icon name={item.icon}/><span>{item.name}</span>{item.name === 'Reportes' && <small>{activeCount}</small>}</button>)}</nav>
      <div className="pilot-sidebar-bottom"><span className="pilot-sandbox-tag"><i/> ENTORNO DE PRUEBA</span><p>Los cambios duran mientras esta página permanezca abierta.</p><button type="button" onClick={resetDemo}>Restablecer demostración</button></div>
    </aside>
    <div className="pilot-content"><div className="pilot-demo-banner"><span aria-hidden="true">◇</span><p><strong>Demostración interactiva</strong> · Datos ficticios. No envía alertas reales.</p></div>
      <header className="pilot-topbar"><div><span className="pilot-overline">POLICÍA NACIONAL + DIGESETT · PROPUESTA</span><h1>{tab === 'Resumen' ? 'Panorama del piloto' : tab}</h1></div><label className="pilot-profile-select">Perfil de demostración<select value={profileId} onChange={event => {setProfileId(event.target.value);setSelectedCaseId(null);setSelectedNoticeId(null);setMessage(null);}}>{DEMO_PROFILES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></header>
      <main className="pilot-main"><div className="pilot-context-line"><span><i/> Santo Domingo · Escenario ilustrativo</span><span>{institutionLabel(profile.institution)}</span></div>
        {message && <div className={`pilot-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}><span>{message.text}</span><button type="button" aria-label="Cerrar mensaje" onClick={() => setMessage(null)}>×</button></div>}
        {tab === 'Resumen' && <>
          <section className="pilot-kpis" aria-label="Indicadores simulados"><button type="button" onClick={() => openReports('active')}><span>Reportes activos</span><strong>{activeCount.toString().padStart(2,'0')}</strong><small>Ver bandeja <b>↗</b></small></button><button type="button" onClick={() => openReports('high')} className="pilot-kpi-caution"><span>Prioridad alta</span><strong>{highCount.toString().padStart(2,'0')}</strong><small>Requieren atención de prueba <b>↗</b></small></button><button type="button" onClick={() => openReports('pending')}><span>Por revisar</span><strong>{pendingCount.toString().padStart(2,'0')}</strong><small>Nuevos y en revisión <b>↗</b></small></button><button type="button" onClick={() => setTab('Cámaras')}><span>Cámaras con señal</span><strong>{onlineCameras}<em>/{data.cameras.length}</em></strong><small>Datos sintéticos <b>↗</b></small></button></section>
          <div className="pilot-overview-grid"><div><MapScheme cases={cases} selectedId={selectedCase?.id} onSelect={id => {setSelectedCaseId(id);setFilter('all');setTab('Reportes');}}/><section className="pilot-card pilot-overview-notices"><div className="pilot-section-heading"><div><span className="pilot-overline">AVISOS CON REVISIÓN</span><h2>De la evidencia a la comunicación</h2></div><button type="button" className="pilot-link-button" onClick={() => setTab('Avisos')}>Preparar aviso →</button></div><div className="pilot-notice-steps"><span><b>1</b> Redactar</span><i>→</i><span><b>2</b> Revisar</span><i>→</i><span><b>3</b> Simular publicación</span></div><p>Una segunda persona revisa la versión antes de mostrarla en la vista ciudadana de prueba.</p></section></div><section className="pilot-card pilot-attention-list"><div className="pilot-section-heading"><div><span className="pilot-overline">BANDEJA DE TRABAJO</span><h2>Requieren revisión</h2></div><button type="button" className="pilot-link-button" onClick={() => openReports()}>Ver todos →</button></div>{cases.filter(item => !['resolved','discarded'].includes(item.state)).slice(0,4).map(item => <button type="button" className="pilot-attention-item" key={item.id} onClick={() => {setSelectedCaseId(item.id);setFilter('all');setQuery('');setTab('Reportes');}}><span className={`pilot-event-dot priority-${item.priority}`}/><div><small>{item.id} · {item.institutions.join(' + ')}</small><strong>{item.title}</strong><span>{stateLabel(item.state)} · {item.zone}</span></div><b>↗</b></button>)}<p className="pilot-attention-footnote">La congestión observada y su causa probable se presentan por separado.</p></section></div>
        </>}
        {tab === 'Reportes' && <><div className="pilot-page-intro"><h2>Bandeja de reportes</h2><p>Selecciona un caso para revisar evidencia y probar su gestión.</p></div><div className="pilot-filters"><label>Buscar reportes<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ID, incidente o zona…"/></label><label>Estado del reporte<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos los estados</option><option value="active">Activos</option><option value="high">Prioridad alta</option><option value="pending">Pendientes de revisión</option>{CASE_STATES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><span>{filtered.length} resultado{filtered.length === 1 ? '' : 's'}</span></div><div className="pilot-inbox-grid"><section className="pilot-case-list" aria-label="Lista de reportes">{filtered.length ? filtered.map(item => <button type="button" key={item.id} className={selectedCase?.id === item.id ? 'is-selected' : ''} onClick={() => setSelectedCaseId(item.id)} aria-label={`${item.id}: ${item.title}`}><div><small>{item.id}</small><span className={`pilot-priority priority-${item.priority}`}>{item.priority}</span></div><strong>{item.title}</strong><p>{item.zone}</p><span className="pilot-status">{stateLabel(item.state)}</span></button>) : <div className="pilot-empty"><Icon name="reports"/><h3>Sin reportes para estos filtros</h3><p>Prueba otro texto o restablece el estado.</p><button type="button" className="pilot-button pilot-button-secondary" onClick={() => {setQuery('');setFilter('all');}}>Limpiar búsqueda</button></div>}</section>{selectedCase ? <CaseDetail item={selectedCase} profile={profile} onAction={onAction}/> : <div className="pilot-empty pilot-card"><p>Selecciona un reporte disponible en esta vista.</p></div>}</div></>}
        {tab === 'Avisos' && <><div className="pilot-page-intro"><h2>Avisos y revisión</h2><p>Ensaya el recorrido completo antes de conectar un canal real de comunicación.</p></div>{canManage(profile) ? <NoticeComposer key={profile.id} onCreate={onAction} profile={profile}/> : <p className="pilot-card pilot-readonly">Esta vista no puede crear avisos. Selecciona un operador o supervisor de demostración.</p>}<div className="pilot-notices-grid"><section className="pilot-card pilot-notice-list"><h2>Avisos del escenario</h2>{notices.map(notice => <button type="button" key={notice.id} className={selectedNotice?.id === notice.id ? 'is-selected' : ''} onClick={() => setSelectedNoticeId(notice.id)}><span className={`pilot-status notice-${notice.status}`}>{noticeLabels[notice.status]}</span><strong>{notice.title}</strong><small>{notice.id} · {notice.institution} · v{notice.version}</small></button>)}{!notices.length && <p className="pilot-muted">No hay avisos en esta vista de prueba.</p>}</section>{selectedNotice ? <NoticeDetail notice={selectedNotice} profile={profile} onAction={onAction}/> : <div className="pilot-empty pilot-card"><p>Crea o selecciona un aviso para revisar su recorrido.</p></div>}</div><section className="pilot-citizen-preview" aria-label="Vista ciudadana simulada"><div className="pilot-section-heading"><div><span className="pilot-overline">ASÍ SE VERÍA EN SAFEROUTE</span><h2>Vista ciudadana simulada</h2></div><span className="pilot-subtle-tag">No se envió a usuarios</span></div>{publicNotices.length ? publicNotices.map(notice => <article key={notice.id}><span className="pilot-preview-institution">{notice.institution} · Ejemplo ficticio</span><h3>{notice.title}</h3><p>{notice.text}</p><small>{notice.zone} · Hasta {dateLabel(notice.validUntil)}</small></article>) : <p>Los avisos aparecerán aquí únicamente después de completar su aprobación y publicación simuladas.</p>}</section></>}
        {tab === 'Cámaras' && <><div className="pilot-page-intro"><h2>Estado de las cámaras</h2><p>Telemetría sintética para revisar el diseño. No hay video ni cámaras institucionales conectadas.</p></div><div className="pilot-camera-grid">{data.cameras.map(camera => <article className="pilot-camera-card" key={camera.id}><div className={`pilot-camera-illustration ${camera.health === 'offline' ? 'is-offline' : ''}`}><Icon name="cameras"/><span>{camera.health === 'offline' ? 'Sin señal de prueba' : 'Medición simulada'}</span><b className={`pilot-camera-health ${camera.health}`}>{camera.health === 'offline' ? 'Sin señal' : 'Con señal'}</b></div><div className="pilot-camera-body"><small>{camera.id}</small><h2>{camera.name}</h2><div className="pilot-camera-values"><div><span>Velocidad promedio</span><strong>{camera.speedKmh === null ? 'Sin medición' : <>{camera.speedKmh}<em> km/h</em></>}</strong></div><div><span>Congestión</span><strong className="pilot-camera-congestion">{camera.congestion || 'Sin determinar'}</strong></div></div><p className="pilot-small">Última señal: {dateLabel(camera.lastSeenAt)}</p><ul>{camera.observed.map((fact,index) => <li key={index}>{fact}</li>)}</ul></div></article>)}</div></>}
        {tab === 'Historial' && <><div className="pilot-page-intro"><h2>Historial de la simulación</h2><button type="button" className="pilot-button pilot-button-secondary pilot-mobile-reset" onClick={resetDemo}>Restablecer demostración</button><p>Los cambios de prueba quedan visibles aquí durante esta sesión.</p></div><section className="pilot-audit-list">{data.audit.map(entry => <article key={entry.id}><div className="pilot-audit-icon"><Icon name="history"/></div><div><small>{dateLabel(entry.createdAt)} · {entry.actorName}</small><h3>{entry.detail || entry.action}</h3><p>{entry.entityId} · {entry.action}</p></div><span className="pilot-subtle-tag">Simulado</span></article>)}{!data.audit.length && <div className="pilot-empty"><h3>El historial está listo</h3><p>Prueba una actualización o un aviso para registrar una acción.</p></div>}</section></>}
      </main><footer className="pilot-footer"><span>SafeRoute · Prototipo de diseño para un piloto conjunto</span><a href="/">Volver a SafeRoute</a><span>Sin conexión institucional · Estado de prueba en memoria</span></footer>
    </div>
  </div>;
}
