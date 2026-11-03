// Interactive design only: synthetic data and in-memory operations, no accounts,
// storage, network requests, institutional integration, or production permissions.
export const DEMO_PROFILES = Object.freeze([
  {id:'op-pn', name:'Operador PN · Demo', role:'operator', institution:'PN'},
  {id:'op-digesett', name:'Operador DIGESETT · Demo', role:'operator', institution:'DIGESETT'},
  {id:'sup-pn', name:'Supervisor PN · Demo', role:'supervisor', institution:'PN'},
  {id:'sup-digesett', name:'Supervisor DIGESETT · Demo', role:'supervisor', institution:'DIGESETT'},
  {id:'reader-pn', name:'Consulta PN · Demo', role:'readonly', institution:'PN'},
  {id:'admin-demo', name:'Administrador · Demo', role:'admin', institution:'ALL'},
].map(Object.freeze));

export const CASE_STATES = Object.freeze([
  ['new','Nuevo'], ['reviewing','En revisión'], ['verified','Verificado'], ['assigned','Asignado'],
  ['in_progress','En atención'], ['resolved','Resuelto'], ['discarded','Descartado'],
].map(([value,label]) => Object.freeze({value,label})));

export class PilotActionError extends Error {
  constructor(code, message) { super(message); this.name = 'PilotActionError'; this.code = code; }
}
const fail = (code, message) => { throw new PilotActionError(code, message); };
const iso = now => new Date(now).toISOString();
const clean = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
function actorFor(profile) {
  const actor = DEMO_PROFILES.find(value => value.id === profile?.id);
  if (!actor || actor.role !== profile.role || actor.institution !== profile.institution) fail('PROFILE','Selecciona un perfil de demostración válido.');
  return actor;
}
const permitted = (actor, institutions) => actor.institution === 'ALL' || institutions.includes(actor.institution);
export const canManage = profile => ['operator','supervisor'].includes(profile?.role);
export const visibleCases = (state, profile) => state.cases.filter(value => permitted(actorFor(profile), value.institutions));
export const visibleNotices = (state, profile) => state.notices.filter(value => permitted(actorFor(profile), [value.institution]));
export const isNoticeExpired = (notice, now = Date.now()) => !Number.isFinite(Date.parse(notice.validUntil)) || Date.parse(notice.validUntil) <= now;
export const publicDemoNotices = (state, now = Date.now()) => state.notices.filter(value => value.status === 'published' && !isNoticeExpired(value, now));

export function createPilotState(now = Date.now()) {
  const ago = minutes => iso(now - minutes * 60000);
  const incident = (id,title,state,priority,institutions,mapX,mapY,observed,probableCause,confidence,confidenceReason,minutes,assignedTo='Sin asignar',category='Otro') => ({
    id,title,state,priority,institutions,zone:'Santo Domingo',category,mapX,mapY,
    lat:Number((18.51 - mapY * .0006).toFixed(4)), lng:Number((-69.97 + mapX * .0005).toFixed(4)),
    observed,probableCause,confidence,confidenceReason,reportedAt:ago(minutes),assignedTo,notes:[],version:1,
  });
  return {
    cases:[
      incident('SR-1024','Fila vehicular en la intersección','reviewing','alta',['PN','DIGESETT'],56,42,
        ['Velocidad ilustrativa de 8 km/h durante 3 minutos.','Tres reportes simulados señalan una fila creciente.'],
        'Exceso de volumen; falta corroborar que no exista un incidente.','medio','Señales persistentes, pero sin verificación independiente de la causa.',6,'Operador DIGESETT · Demo'),
      incident('SR-1025','Semáforo reportado apagado','new','alta',['DIGESETT'],35,29,
        ['Un ciudadano ficticio reportó un semáforo apagado.','No hay imagen ni confirmación de un agente.'],
        'Posible falla del semáforo.','bajo','Un solo reporte sin corroboración; el funcionamiento aún no se comprobó.',12),
      incident('SR-1026','Árbol sobre parte de la vía','verified','media',['PN'],72,66,
        ['Dos reportes ficticios coinciden en una obstrucción.','Un verificador de demostración confirmó el ejemplo.'],
        'Obstrucción parcial por un árbol en el escenario simulado.','alto','Corroboración incluida solo como parte del escenario ficticio.',19),
      incident('SR-1027','Bache en el carril derecho','in_progress','media',['DIGESETT'],24,68,
        ['Reporte de demostración de un hueco en la calzada.','Se asignó una atención ficticia al caso.'],
        'Daño de la superficie vial.','medio','Descripción consistente; falta una inspección real.',34,'Operador DIGESETT · Demo','Bache'),
      incident('SR-1028','Vehículo detenido cerca de la acera','assigned','media',['PN','DIGESETT'],68,23,
        ['Un objeto con forma de vehículo permanece quieto en el ejemplo.','No se observa evidencia suficiente para afirmar un accidente.'],
        'Vehículo detenido; motivo sin determinar.','bajo','Estar detenido no demuestra avería ni accidente.',27,'Operador PN · Demo'),
      incident('SR-1029','Agua acumulada junto al cruce','resolved','baja',['PN'],43,79,
        ['Caso sintético de acumulación de agua.','Se registró una resolución de demostración.'],
        'Origen del agua sin determinar.','bajo','No hay datos meteorológicos ni inspección que expliquen el origen.',65),
    ],
    cameras:[
      {id:'CAM-DEMO-01',name:'Cruce Norte · Demo',health:'online',congestion:'denso',speedKmh:8,lastSeenAt:ago(.05),lat:18.4848,lng:-69.942,mapX:56,mapY:42,observed:['Métrica sintética reciente; sin video real.']},
      {id:'CAM-DEMO-02',name:'Corredor Central · Demo',health:'online',congestion:'fluido',speedKmh:34,lastSeenAt:ago(.08),lat:18.468,lng:-69.958,mapX:24,mapY:68,observed:['Métrica sintética reciente; sin video real.']},
      {id:'CAM-DEMO-03',name:'Acceso Este · Demo',health:'offline',congestion:null,speedKmh:null,lastSeenAt:ago(18),lat:18.4704,lng:-69.934,mapX:72,mapY:66,observed:['Sin datos en el escenario; no equivale a tráfico detenido.']},
    ],
    notices:[
      {id:'AV-DEMO-001',title:'Precaución junto al cruce Norte',text:'Ejemplo: disminuye la velocidad al acercarte a la intersección.',institution:'PN',zone:'Santo Domingo',validUntil:iso(now+3600000),status:'draft',version:1,authorId:'op-pn',authorName:'Operador PN · Demo',approvedBy:null,approvedVersion:null,createdAt:ago(15),updatedAt:ago(15)},
      {id:'AV-DEMO-002',title:'Revisión de un semáforo · Ejemplo',text:'Aviso ficticio: personal de demostración revisa el funcionamiento del semáforo.',institution:'DIGESETT',zone:'Santo Domingo',validUntil:iso(now+7200000),status:'submitted',version:2,authorId:'op-digesett',authorName:'Operador DIGESETT · Demo',approvedBy:null,approvedVersion:null,createdAt:ago(20),updatedAt:ago(8)},
      {id:'AV-DEMO-003',title:'Atención en el corredor · Simulado',text:'Ejemplo de aviso aprobado: mantén la atención y respeta las indicaciones de tránsito.',institution:'PN',zone:'Santo Domingo',validUntil:iso(now+5400000),status:'published',version:4,authorId:'op-pn',authorName:'Operador PN · Demo',approvedBy:'sup-pn',approvedVersion:3,createdAt:ago(40),updatedAt:ago(25)},
    ],
    audit:[{id:'audit-seed',actorId:'system-demo',actorName:'Escenario de demostración',action:'Escenario iniciado',entityId:'PILOTO',detail:'Datos ficticios; no hay conexión institucional ni mensajes enviados.',createdAt:iso(now)}],
  };
}

export function applyPilotAction(state, action, profile, now = Date.now()) {
  const actor = actorFor(profile);
  if (!Number.isFinite(now) || !action || typeof action.type !== 'string') fail('INVALID','La acción de prueba no es válida.');
  const authorize = institutions => {
    if (!canManage(actor) || !permitted(actor, institutions)) fail('FORBIDDEN','Este perfil no puede modificar este elemento de demostración.');
  };
  const version = entity => {
    if (action.expectedVersion !== entity.version) fail('CONFLICT','El elemento cambió. Revisa su versión antes de continuar.');
  };
  const record = (next, label, id, detail) => ({...next, audit:[{
    id:`audit-${now}-${state.audit.length+1}`,actorId:actor.id,actorName:actor.name,
    action:label,entityId:id,detail,createdAt:iso(now),
  }, ...state.audit]});
  const noticeFields = value => {
    if (!clean(value.title,3,100) || !clean(value.text,12,600) || !clean(value.zone,3,80)) fail('INVALID','Escribe un título, una zona y un mensaje de entre 12 y 600 caracteres.');
    const expiry = Date.parse(value.validUntil);
    if (!Number.isFinite(expiry) || expiry <= now || expiry > now+7*86400000) fail('EXPIRY','El aviso debe vencer en los próximos siete días.');
    return {title:value.title.trim(),text:value.text.trim(),zone:value.zone.trim(),validUntil:iso(expiry)};
  };
  if (action.type.startsWith('CASE_')) {
    const current = state.cases.find(value => value.id === action.caseId);
    if (!current) fail('NOT_FOUND','No se encontró el caso de prueba.');
    authorize(current.institutions);
    let next;
    if (action.type === 'CASE_UPDATE') {
      version(current);
      const patch = action.patch;
      if (!patch || !Object.keys(patch).length || Object.keys(patch).some(key=>!['state','priority','assignedTo'].includes(key)) ||
          ('state' in patch && !CASE_STATES.some(value=>value.value===patch.state)) ||
          ('priority' in patch && !['alta','media','baja'].includes(patch.priority)) ||
          ('assignedTo' in patch && !clean(patch.assignedTo,1,80))) fail('INVALID','Revisa el estado, la prioridad y la asignación del caso.');
      next = {...current,...patch,assignedTo:patch.assignedTo?.trim() || current.assignedTo,version:current.version+1};
    } else if (action.type === 'CASE_NOTE') {
      if (action.expectedVersion !== undefined) version(current);
      if (!clean(action.text,3,600)) fail('INVALID','Escribe una nota de prueba de entre 3 y 600 caracteres.');
      next = {...current,version:current.version+1,notes:[...current.notes,{
        id:`note-${current.id}-${current.notes.length+1}`,text:action.text.trim(),authorId:actor.id,authorName:actor.name,createdAt:iso(now),
      }]};
    } else fail('INVALID','La acción del caso no está disponible.');
    return record({...state,cases:state.cases.map(value=>value.id===current.id?next:value)}, action.type==='CASE_NOTE'?'Nota de prueba añadida':'Caso de prueba actualizado',current.id,action.type==='CASE_NOTE'?'Se añadió una nota interna simulada.':`Estado: ${next.state}; prioridad: ${next.priority}; responsable: ${next.assignedTo}.`);
  }
  if (action.type === 'NOTICE_CREATE') {
    if (!['PN','DIGESETT'].includes(action.institution)) fail('INVALID','Selecciona una institución del piloto.');
    authorize([action.institution]);
    const fields = noticeFields(action);
    const notice = {...fields,id:`AV-DEMO-${String(state.notices.length+1).padStart(3,'0')}`,institution:action.institution,status:'draft',version:1,
      authorId:actor.id,authorName:actor.name,approvedBy:null,approvedVersion:null,createdAt:iso(now),updatedAt:iso(now)};
    return record({...state,notices:[notice,...state.notices]},'Borrador de prueba creado',notice.id,'No se publicó ni se envió a ciudadanos.');
  }
  if (action.type.startsWith('NOTICE_')) {
    const current = state.notices.find(value=>value.id===action.noticeId);
    if (!current) fail('NOT_FOUND','No se encontró el aviso de prueba.');
    authorize([current.institution]);
    version(current);
    let next = {...current,version:current.version+1,updatedAt:iso(now)};
    let label, detail='Solo cambió esta simulación; no se envió a ciudadanos.';
    if (action.type === 'NOTICE_EDIT') {
      if (current.authorId!==actor.id || ['published','retracted'].includes(current.status)) fail('FORBIDDEN','Solo el autor puede editar un aviso antes de publicarlo.');
      if (!action.patch || Object.keys(action.patch).some(key=>!['title','text','zone','validUntil'].includes(key))) fail('INVALID','El cambio del aviso no es válido.');
      next={...next,...noticeFields({...current,...action.patch}),status:'draft',approvedBy:null,approvedVersion:null};
      label='Borrador editado; aprobación invalidada';
    } else if (action.type === 'NOTICE_SUBMIT') {
      if (current.authorId!==actor.id || current.status!=='draft') fail('FORBIDDEN','El autor debe enviar un borrador a revisión.');
      noticeFields(current);
      next.status='submitted'; label='Aviso de prueba enviado a revisión';
    } else if (action.type === 'NOTICE_APPROVE') {
      if (actor.role!=='supervisor' || actor.id===current.authorId || current.status!=='submitted') fail('APPROVAL','Un supervisor distinto del autor debe aprobar la versión enviada.');
      noticeFields(current);
      next={...next,status:'approved',approvedBy:actor.id,approvedVersion:next.version}; label='Versión de prueba aprobada';
    } else if (action.type === 'NOTICE_PUBLISH') {
      if (actor.role!=='supervisor' || current.status!=='approved' || !current.approvedBy || current.authorId===current.approvedBy || current.approvedVersion!==current.version) fail('APPROVAL','Publicar requiere la versión aprobada por un supervisor distinto del autor.');
      noticeFields(current);
      next.status='published'; next.publishedAt=iso(now); label='Publicación simulada';
    } else if (action.type === 'NOTICE_RETRACT') {
      if (actor.role!=='supervisor' || current.status!=='published') fail('FORBIDDEN','Solo un supervisor puede retirar un aviso publicado de prueba.');
      if (!clean(action.reason,5,300)) fail('INVALID','Indica un motivo de retiro de entre 5 y 300 caracteres.');
      next={...next,status:'retracted',retractedBy:actor.id,retractionReason:action.reason.trim()}; label='Aviso de prueba retirado'; detail=`Motivo de prueba: ${next.retractionReason}`;
    } else fail('INVALID','La acción del aviso no está disponible.');
    return record({...state,notices:state.notices.map(value=>value.id===current.id?next:value)},label,current.id,detail);
  }
  fail('INVALID','La acción de demostración no está disponible.');
}
