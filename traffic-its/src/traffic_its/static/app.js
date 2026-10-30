/* Metadata-only dashboard. Credentials and latest states live in page memory. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const model = {token:'', demo:false, cameras:new Map(), states:new Map(), alerts:new Map(), selected:'', cursor:'0', revisions:new Map(), socket:null, socketGeneration:0, reconnectTimer:null, retry:0, serverOffset:0, connected:false, history:[], snapshotGeneration:0, historyGeneration:0};
  const colours = {fluido:'#2c8760',moderado:'#c49927',denso:'#cd7437',detenido:'#bb4c43',desconocido:'#718078'};
  const congestionLabels = {fluido:'Fluido',moderado:'Moderado',denso:'Denso',detenido:'Detenido',desconocido:'Desconocida',unknown:'Desconocida'};
  const healthLabels = {healthy:'Operativa',ok:'Operativa',degraded:'Degradada',offline:'Sin señal',no_frames:'Sin imágenes',unavailable:'No disponible',source_unavailable:'Fuente no disponible',stopped:'Procesamiento detenido',freeze_suspected:'Posible congelamiento',scene_changed:'Encuadre cambiado',view_unusable:'Imagen no utilizable',replay_finished:'Reproducción terminada',starting:'Iniciando',stale:'Datos vencidos',unknown:'Sin datos'};
  let map, markerLayer, tiles;

  function text(value, fallback='—') {return value === null || value === undefined || value === '' ? fallback : String(value).replace(/rtsps?:\/\/\S+/gi,'[fuente privada]');}
  function node(tag, content, className) {const element=document.createElement(tag);if(content!==undefined)element.textContent=text(content,'');if(className)element.className=className;return element;}
  function finite(value) {return typeof value==='number'&&Number.isFinite(value);}
  function number(value,digits=0) {return finite(value)?new Intl.NumberFormat('es-DO',{maximumFractionDigits:digits}).format(value):'—';}
  function speed(value) {return finite(value)?`${number(value,1)} km/h`:'No medible';}
  function items(response) {return Array.isArray(response)?response:Array.isArray(response?.items)?response.items:[];}
  function now() {return Date.now()+model.serverOffset;}
  function ageSeconds(date) {const time=Date.parse(date);return Number.isFinite(time)?Math.max(0,(now()-time)/1000):null;}
  function ageLabel(seconds) {return seconds===null?'sin hora':seconds<2?'ahora':seconds<60?`hace ${Math.floor(seconds)} s`:`hace ${Math.floor(seconds/60)} min`;}
  function stale(state) {const age=ageSeconds(state?.received_at||state?.ingested_at||state?.updated_at);return state?.stale===true||age===null||age>15;}
  function healthCode(state) {return state?.health?.status||state?.health?.code||state?.camera_status||'unknown';}
  function usable(state) {return state&&!stale(state)&&state.health?.usable_for_analytics!==false&&!['offline','no_frames','unavailable','source_unavailable','stopped','freeze_suspected','scene_changed','view_unusable','replay_finished'].includes(healthCode(state));}
  function stateMode(state,camera) {return state?.source_mode||camera?.source?.mode||camera?.source_mode||camera?.mode||(model.demo?'demo':'unknown');}
  function isDemo(mode) {return ['demo','synthetic','simulated'].includes(mode);}
  function dateLabel(value) {const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('es-DO',{dateStyle:'short',timeStyle:'medium'}):'Hora desconocida';}
  function selectedStates() {return model.selected?[model.states.get(model.selected)].filter(Boolean):[...model.states.values()];}
  function showMessage(message) {$('request-message').textContent=message||'';$('request-message').hidden=!message;}
  function connection(label,status='') {$('connection-label').textContent=label;$('connection-dot').className=`status-dot ${status}`;}

  async function request(path,options={}) {
    const headers={Accept:'application/json',...(options.headers||{})};
    if(model.token)headers.Authorization=`Bearer ${model.token}`;
    if(options.body)headers['Content-Type']='application/json';
    const response=await fetch(path,{...options,headers,cache:'no-store',credentials:'omit'});
    if(response.status===401||response.status===403) {const error=new Error('Introduce una clave de operador válida para acceder al servicio.');error.auth=true;throw error;}
    if(response.status===410) {const error=new Error('El historial de conexión venció. Se actualizará el estado.');error.resync=true;throw error;}
    if(!response.ok)throw new Error('No se pudo consultar el servicio. Revisa la conexión y vuelve a intentarlo.');
    return response.json();
  }

  function clearData() {model.cameras.clear();model.states.clear();model.alerts.clear();model.revisions.clear();model.cursor='0';model.selected='';model.history=[];renderAll();renderHistory();}
  function acceptState(state) {
    if(!state||typeof state!=='object'||!state.camera_id)return;
    const current=model.states.get(state.camera_id);
    if(current&&finite(current.revision)&&finite(state.revision)&&state.revision<current.revision)return;
    model.states.set(state.camera_id,state);
  }
  function acceptAlert(alert) {
    const id=alert?.alert_id||alert?.id;if(!id)return;
    const current=model.alerts.get(id);
    if(current&&finite(current.revision)&&finite(alert.revision)&&alert.revision<current.revision)return;
    model.alerts.set(id,alert);
  }

  async function refreshSnapshot({reset=false}={}) {
    const generation=++model.snapshotGeneration;
    try {
      const snapshot=await request('/v1/snapshot');
      if(generation!==model.snapshotGeneration)return false;
      if(reset)clearData();
      model.demo=snapshot.demo===true;
      if(snapshot.server_time){const server=Date.parse(snapshot.server_time);if(Number.isFinite(server))model.serverOffset=server-Date.now();}
      model.cameras.clear();model.states.clear();model.alerts.clear();
      for(const camera of items(snapshot.cameras)){const id=camera.camera_id||camera.id;if(!id)continue;model.cameras.set(id,{...camera,camera_id:id});if(camera.state)acceptState({...camera.state,camera_id:id});}
      for(const state of items(snapshot.states))acceptState(state);
      for(const alert of items(snapshot.alerts))acceptAlert(alert);
      model.cursor=text(snapshot.cursor,'0');
      if(model.selected&&!model.cameras.has(model.selected)&&!model.states.has(model.selected))model.selected='';
      if(!model.selected&&model.cameras.size===1)model.selected=model.cameras.keys().next().value;
      showMessage('');renderAll();loadHistory();return true;
    }catch(error){
      if(generation!==model.snapshotGeneration)return false;
      connection(error.auth?'Acceso requerido':'Servicio no disponible','error');showMessage(error.message);
      if(error.auth){$('access-panel').hidden=false;$('access-toggle').setAttribute('aria-expanded','true');}
      renderOverview();return false;
    }
  }

  let cameraMetadataLoading=false;
  async function refreshCameraMetadata() {
    if(cameraMetadataLoading)return;
    cameraMetadataLoading=true;const generation=model.snapshotGeneration;
    try {
      const response=await request('/v1/cameras');
      if(generation!==model.snapshotGeneration)return;
      for(const camera of items(response)){const id=camera.camera_id||camera.id;if(!id)continue;model.cameras.set(id,{...camera,camera_id:id});if(camera.state)acceptState({...camera.state,camera_id:id});}
      if(!model.selected&&model.cameras.size===1)model.selected=model.cameras.keys().next().value;
      renderAll();
    }catch{/* The durable stream and next snapshot remain authoritative. */}
    finally{cameraMetadataLoading=false;}
  }

  function stopSocket() {model.socketGeneration++;clearTimeout(model.reconnectTimer);model.connected=false;if(model.socket){model.socket.onclose=null;model.socket.close();model.socket=null;}}
  function connectSocket() {
    stopSocket();
    const generation=model.socketGeneration;
    connection('Conectando…');
    let socket;
    try {socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/v1/stream`);}catch{scheduleReconnect(generation);return;}
    model.socket=socket;
    socket.onopen=()=>{if(generation!==model.socketGeneration)return;socket.send(JSON.stringify({token:model.token||null,cursor:model.cursor}));};
    socket.onmessage=event=>{
      if(generation!==model.socketGeneration)return;
      let message;try{message=JSON.parse(event.data);}catch{return;}
      const kind=message.event_type||message.type;
      if(kind==='resync_required'){stopSocket();refreshSnapshot().then(ok=>{if(ok)connectSocket();});return;}
      if(kind==='error'||kind==='auth_error'){showMessage('No se pudo autorizar la conexión de alertas.');return;}
      if(kind==='stream.ready'||kind==='heartbeat'){model.connected=true;model.retry=0;connection('Conectado','connected');return;}
      // An event is applied only once, but the durable cursor always advances.
      if(message.cursor!==undefined)model.cursor=String(message.cursor);
      const identity=message.entity_id;
      const revision=message.revision;
      const key=`${kind}:${identity}`;
      const previous=model.revisions.get(key);
      if(previous!==undefined&&finite(revision)&&revision<=previous)return;
      if(finite(revision))model.revisions.set(key,revision);
      const payload=message.payload||{};
      if(kind==='camera.state.updated'){const state=payload.state||payload;acceptState(state);if(!model.cameras.has(state.camera_id))refreshCameraMetadata();}
      if(kind==='alert.updated')acceptAlert(payload.alert||payload);
      model.connected=true;model.retry=0;connection('Conectado','connected');renderAll();
    };
    socket.onclose=event=>{if(generation!==model.socketGeneration)return;model.connected=false;renderOverview();if([1008,4401,4403].includes(event.code)){connection('Acceso requerido','error');showMessage('Introduce una clave de operador válida para acceder al servicio.');return;}scheduleReconnect(generation);};
    socket.onerror=()=>{if(generation===model.socketGeneration)connection('Reconectando…','error');};
  }
  function scheduleReconnect(generation) {
    if(generation!==model.socketGeneration)return;
    connection('Reconectando…','error');
    const delay=Math.min(30000,1000*2**Math.min(model.retry++,5));
    model.reconnectTimer=setTimeout(()=>{if(generation===model.socketGeneration)connectSocket();},delay);
  }

  function renderSelect() {
    const select=$('camera-select');const existing=select.value;
    const ids=new Set([...model.cameras.keys(),...model.states.keys()]);
    select.replaceChildren(node('option','Todas las cámaras'));select.firstChild.value='';
    for(const id of ids){const camera=model.cameras.get(id);const option=node('option',camera?.name||id);option.value=id;select.append(option);}
    select.value=model.selected||existing||'';
    $('camera-count').textContent=`${ids.size} ${ids.size===1?'cámara':'cámaras'}`;
  }
  function renderOverview() {
    const states=selectedStates();const state=states.length===1?states[0]:null;
    const mode=stateMode(state,model.cameras.get(model.selected));const valid=usable(state);const banner=$('source-banner');
    banner.className='source-banner';
    if(isDemo(mode)){banner.classList.add('demo');banner.textContent='DEMOSTRACIÓN SINTÉTICA · Vehículos y mediciones generados para probar el sistema. No representa tránsito real.';}
    else if(mode==='replay'){banner.classList.add('replay');banner.textContent='VIDEO GRABADO · Son mediciones de una reproducción. No describen el tránsito actual.';}
    else if(mode==='live'){banner.textContent='FUENTE DE CÁMARA · Mediciones sobre la ventana observada. La vigencia depende del reloj de captura y de la calidad de la imagen.';}
    else banner.textContent=states.length>1?'Selecciona una cámara para consultar sus mediciones.':'Esperando datos del servicio.';
    if(state&&stale(state)){banner.classList.add('stale');banner.textContent+=' Datos vencidos: esperando nuevas observaciones.';}
    const mean=state?.mean_speed_kmh;
    $('speed-value').textContent=states.length>1?'Por cámara':valid&&state?.speed_valid===true&&finite(mean)?speed(mean):'—';
    $('speed-value').classList.toggle('stale-value',!valid);
    $('speed-quality').textContent=state?stale(state)?'Último dato vencido':state.speed_valid===true?'Estimación en la región calibrada':'No medible: calibración o soporte insuficiente':'Sin una medición válida';
    const congestion=valid?state?.congestion:'desconocido';
    $('congestion-value').textContent=states.length>1?'Por cámara':congestionLabels[congestion]||'Desconocida';
    $('congestion-value').style.color=colours[congestion]||colours.desconocido;
    $('congestion-quality').textContent=state?isDemo(mode)?'Estado simulado, sin precisión real validada':!valid?'Observaciones insuficientes o vencidas':'Estado de la ventana; no identifica una causa':'Esperando observaciones';
    const lanes=Array.isArray(state?.lanes)?state.lanes:[];const countLanes=lanes.filter(lane=>lane.count_valid===true&&finite(lane.count));
    $('count-value').textContent=states.length>1?'Por cámara':valid&&countLanes.length?number(countLanes.reduce((sum,lane)=>sum+lane.count,0)):'—';
    $('count-quality').textContent=countLanes.length?`${countLanes.length} ${countLanes.length===1?'carril observado':'carriles observados'} · ventana en curso`:'Sin aforo válido por carril';
    $('health-value').textContent=state?healthLabels[healthCode(state)]||'Revisar calidad':states.length>1?'Por cámara':'Sin datos';
    const arrival=ageSeconds(state?.received_at||state?.ingested_at);const capture=state?.capture_at||state?.capture_start;
    $('freshness-value').textContent=state?`Recepción ${ageLabel(arrival)} · ${capture?`captura ${dateLabel(capture)}`:'captura desconocida'}`:'Hora de captura desconocida';
    $('measurement-time').textContent=state?finite(state.media_time_s)?`Tiempo del video: ${number(state.media_time_s,1)} s`:capture?dateLabel(capture):'Captura UTC desconocida':'Sin observaciones';
  }

  function selectCamera(id) {model.selected=id;$('camera-select').value=id;renderAll();loadHistory();const locationPoint=cameraPoint(model.cameras.get(id));if(map&&locationPoint)map.setView(locationPoint,15);}
  function renderCameras() {
    const list=$('camera-list');list.replaceChildren();
    const ids=new Set([...model.cameras.keys(),...model.states.keys()]);
    for(const id of ids){
      const camera=model.cameras.get(id)||{};const state=model.states.get(id);const card=node('button',undefined,`camera-card ${model.selected===id?'selected':''}`);card.type='button';card.setAttribute('aria-pressed',String(model.selected===id));
      const top=node('span',undefined,'camera-card-top');top.append(node('span',camera.name||id,'camera-name'),node('span',state?healthLabels[healthCode(state)]||'Revisar':'Sin datos','health-badge'));card.append(top);
      const valid=usable(state);const mode=stateMode(state,camera);
      card.append(node('p',`${valid&&state?.speed_valid?speed(state.mean_speed_kmh):'Velocidad no medible'} · ${valid?congestionLabels[state.congestion]||'Desconocida':'Sin datos vigentes'}`));
      card.append(node('small',`${isDemo(mode)?'SIMULADO':mode==='replay'?'VIDEO GRABADO':mode==='live'?'CÁMARA':'SIN FUENTE'} · recepción ${ageLabel(ageSeconds(state?.received_at||state?.ingested_at))}`));
      card.addEventListener('click',()=>selectCamera(id));list.append(card);
    }
    if(!ids.size)list.append(node('p','No hay cámaras disponibles.','empty'));
  }

  function cameraPoint(camera) {const loc=camera?.location||{};const lat=loc.latitude??camera?.latitude;const lon=loc.longitude??camera?.longitude;return finite(lat)&&Math.abs(lat)<=90&&finite(lon)&&Math.abs(lon)<=180?[lat,lon]:null;}
  function renderMap() {
    if(!map)return;markerLayer.clearLayers();let located=0;
    for(const [id,camera] of model.cameras){const point=cameraPoint(camera);if(!point)continue;located++;const state=model.states.get(id);const colour=usable(state)?colours[state.congestion]||colours.desconocido:colours.desconocido;const marker=L.circleMarker(point,{radius:model.selected===id?10:7,color:'#fff',weight:2,fillColor:colour,fillOpacity:1});const popup=node('div');popup.append(node('strong',camera.name||id),node('p',`${isDemo(stateMode(state,camera))?'Ubicación de demostración · ':''}${usable(state)?congestionLabels[state.congestion]||'Desconocida':'Datos no disponibles'}`));marker.bindPopup(popup).on('click',()=>selectCamera(id)).addTo(markerLayer);}
    $('map-caption').textContent=located?`${located} ${located===1?'ubicación configurada':'ubicaciones configuradas'}.`:'Sin ubicación configurada: las cámaras no se colocan en coordenadas inventadas.';
  }
  function initMap() {
    if(!window.L){$('map-message').textContent='Mapa no disponible. Las mediciones siguen disponibles.';return;}
    map=L.map('traffic-map',{scrollWheelZoom:false}).setView([18.48,-69.94],11);markerLayer=L.layerGroup().addTo(map);
    $('basemap-button').addEventListener('click',()=>{if(tiles)return;tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);tiles.on('tileerror',()=>{$('map-message').textContent='No se pudo cargar parte del mapa base. Las mediciones siguen disponibles.';});$('basemap-button').textContent='Mapa base activado';$('basemap-button').disabled=true;$('map-message').textContent='Mapa base de OpenStreetMap.';});
  }

  function cell(row,content) {row.append(node('td',content));}
  function classCount(lane,name) {const values=lane.counts_by_class||lane.count_by_class||{};return finite(values[name])?number(values[name]):'0';}
  function renderLanes() {
    const body=$('lanes-body');body.replaceChildren();let rows=0;
    for(const state of selectedStates()){for(const lane of Array.isArray(state.lanes)?state.lanes:[]){rows++;const row=node('tr');cell(row,`${state.camera_id} / ${lane.id||lane.lane_id||'—'}`);const valid=usable(state)&&lane.count_valid===true;
      for(const name of ['carro','moto','guagua_bus','camion'])cell(row,valid?classCount(lane,name):'—');cell(row,valid?number(lane.count):'No medible');cell(row,usable(state)&&lane.speed_valid===true?speed(lane.mean_speed_kmh):'No medible');cell(row,finite(lane.coverage_seconds)?`${number(lane.coverage_seconds,1)} s observados`:'Sin cobertura');body.append(row);}}
    if(!rows){const row=node('tr');const empty=node('td','Todavía no hay aforo por carril.','empty');empty.colSpan=8;row.append(empty);body.append(row);}
  }

  function alertConfidence(cause) {const value=cause?.confidence_level||cause?.confidence||'bajo';return {high:'alto',medium:'medio',low:'bajo'}[value]||(['alto','medio','bajo'].includes(value)?value:'bajo');}
  function factDescription(fact) {if(typeof fact==='string')return fact;return fact?.description||fact?.text||text(fact?.fact_code||fact?.fact,'Observación registrada').replaceAll('_',' ');}
  function alertTitle(alert) {return alert.title||({camera_offline:'Cámara sin señal',camera_health:'Calidad de cámara',no_frames:'Sin imágenes recibidas',freeze_suspected:'Posible imagen congelada',scene_changed:'Encuadre cambiado'}[alert.code||alert.type||alert.alert_type])||'Aviso de observación';}
  function activeAlert(alert) {return alert.suppressed!==true&&!['resolved','expired','suppressed','resuelto','vencido'].includes(alert.status||alert.state);}
  function acknowledgedAlert(alert) {return alert.acknowledged===true||alert.review?.action==='acknowledge'||Boolean(alert.acknowledged_at);}
  function alertObservationStale(alert) {
    if(alert.observation_stale===true)return true;
    return alert.kind==='congestion_observed'&&!usable(model.states.get(alert.camera_id));
  }
  function renderAlerts() {
    const list=$('alerts-list');list.replaceChildren();const alerts=[...model.alerts.values()].filter(alert=>(!model.selected||alert.camera_id===model.selected)&&activeAlert(alert));$('alert-count').textContent=`${alerts.length} ${alerts.length===1?'activa':'activas'}`;
    for(const alert of alerts){const article=node('article',undefined,'alert-card');const causes=Array.isArray(alert.probable_causes)?alert.probable_causes:alert.probable_cause?[alert.probable_cause]:[];const cause=causes[0];const confidence=alertConfidence(cause);const top=node('div',undefined,'alert-card-top');top.append(node('h3',alertTitle(alert)),node('span',`Confianza: ${confidence}`,`confidence ${confidence}`));article.append(top,node('p',`${alert.camera_id||'Cámara sin identificar'} · ${dateLabel(alert.updated_at||alert.emitted_at||alert.created_at)}`,'alert-context'));
      if(alertObservationStale(alert))article.append(node('p','Observación vencida; estado actual desconocido.','alert-observation-stale'));
      article.append(node('p','Observado','alert-label'));const observations=Array.isArray(alert.observed)?alert.observed:alert.observed?[alert.observed]:[];const facts=node('ul');for(const fact of observations)facts.append(node('li',factDescription(fact)));if(!observations.length)facts.append(node('li','No hay observaciones detalladas disponibles.'));article.append(facts,node('p','Causa probable','alert-label'),node('p',cause?.description||cause?.label||'Causa no determinada. Este piloto informa hechos y estado de la cámara.'));
      const criteria=cause?.criteria_met||[];if(criteria.length)article.append(node('p',`Criterio: ${criteria.map(value=>text(value,'').replaceAll('_',' ')).join('; ')}.`));const missing=cause?.missing_evidence||[];if(missing.length)article.append(node('p',`Por confirmar: ${missing.map(value=>text(value,'').replaceAll('_',' ')).join('; ')}.`));article.append(node('p','Acción recomendada','alert-label'),node('p',alert.recommended_action||'Revisar el estado y la calidad de la cámara.'));
      if(model.token&&!acknowledgedAlert(alert)){const acknowledge=node('button','Reconocer','quiet');acknowledge.type='button';acknowledge.addEventListener('click',async()=>{acknowledge.disabled=true;try{await request(`/v1/alerts/${encodeURIComponent(alert.alert_id||alert.id)}/review`,{method:'POST',body:JSON.stringify({action:'acknowledge'})});stopSocket();if(await refreshSnapshot())connectSocket();}catch(error){showMessage(error.message);acknowledge.disabled=false;}});article.append(acknowledge);}else if(acknowledgedAlert(alert))article.append(node('p','Reconocida por un operador','alert-context'));list.append(article);
    }
    if(!alerts.length)list.append(node('p','No hay alertas disponibles. Esto no garantiza que la vía esté libre de incidentes.','empty'));
  }

  async function loadHistory() {
    const generation=++model.historyGeneration;const camera=model.selected;
    $('refresh-history').disabled=true;
    try {const query=new URLSearchParams({limit:'120'});if(camera)query.set('camera_id',camera);const result=await request(`/v1/metrics/history?${query}`);if(generation!==model.historyGeneration)return;model.history=items(result);renderHistory();}catch(error){if(generation!==model.historyGeneration)return;model.history=[];renderHistory();$('history-caption').textContent=error.auth?'Acceso de operador requerido.':'No se pudo actualizar el histórico; puedes volver a intentarlo.';}finally{if(generation===model.historyGeneration)$('refresh-history').disabled=false;}
  }
  function historicalStart(row) {return row.window_start_media_s??row.bin_start_media_s??row.start_media_s??row.media_start_s??row.window_start_s??row.bin_start_s??null;}
  function renderHistory() {
    const body=$('history-body');body.replaceChildren();const rows=model.history;
    $('history-caption').textContent='Ventanas conservadas por el servicio, con su cobertura. Los tiempos relativos pertenecen al video.';
    for(const metric of rows){const row=node('tr');cell(row,`${metric.camera_id||'—'} / ${metric.lane_id||metric.id||'—'}`);const start=historicalStart(metric);const absolute=metric.capture_start||metric.window_start_utc;cell(row,absolute?dateLabel(absolute):finite(start)?`Video: ${number(start,1)}–${number(start+(metric.duration_seconds||60),1)} s`:'Tiempo de video no disponible');cell(row,metric.count_valid===false?'No medible':number(metric.count));cell(row,metric.speed_valid===false?'No medible':speed(metric.mean_speed_kmh));cell(row,finite(metric.coverage_seconds)?`${number(metric.coverage_seconds,1)} / ${number(metric.duration_seconds||60)} s`:'Sin cobertura');cell(row,`${isDemo(metric.source_mode)?'Simulado':metric.source_mode==='replay'?'Video grabado':metric.count_valid===false?'No medible':'Observado'}${metric.partial?' · parcial':''}`);body.append(row);}
    if(!rows.length){const row=node('tr');const empty=node('td','Sin histórico disponible. Las ventanas se conservarán cuando haya observaciones.','empty');empty.colSpan=6;row.append(empty);body.append(row);}
    const chart=$('history-chart');chart.replaceChildren();const values=rows.filter(row=>finite(row.count)&&row.count_valid!==false).slice(0,24).reverse();
    if(!values.length){chart.append(node('span','El gráfico aparecerá cuando haya ventanas de conteo.'));return;}
    const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 720 120');svg.setAttribute('role','img');svg.setAttribute('aria-label','Vehículos contados por ventana; cada barra representa una ventana conservada.');const max=Math.max(1,...values.map(row=>row.count));const step=700/values.length;
    for(let i=0;i<values.length;i++){const value=values[i];const height=value.count/max*80;const rect=document.createElementNS(ns,'rect');rect.setAttribute('x',String(10+i*step+step*.12));rect.setAttribute('y',String(94-height));rect.setAttribute('width',String(Math.max(2,step*.76)));rect.setAttribute('height',String(Math.max(1,height)));rect.setAttribute('rx','3');const title=document.createElementNS(ns,'title');title.textContent=`${value.camera_id||''} / ${value.lane_id||''}: ${value.count} vehículos, ${number(value.coverage_seconds,1)} segundos observados`;rect.append(title);svg.append(rect);const label=document.createElementNS(ns,'text');label.setAttribute('x',String(10+i*step+step/2));label.setAttribute('y','110');label.setAttribute('text-anchor','middle');label.textContent=String(value.count);svg.append(label);}chart.append(svg);
  }
  function renderAll() {renderSelect();renderOverview();renderCameras();renderMap();renderLanes();renderAlerts();}

  $('camera-select').addEventListener('change',event=>selectCamera(event.target.value));
  $('access-toggle').addEventListener('click',()=>{const open=$('access-panel').hidden;$('access-panel').hidden=!open;$('access-toggle').setAttribute('aria-expanded',String(open));if(open)$('api-token').focus();});
  $('access-form').addEventListener('submit',async event=>{event.preventDefault();stopSocket();model.token=$('api-token').value.trim();$('api-token').value='';clearData();connection('Conectando…');if(await refreshSnapshot()){connectSocket();$('access-panel').hidden=true;$('access-toggle').setAttribute('aria-expanded','false');}});
  $('clear-access').addEventListener('click',async()=>{stopSocket();model.token='';$('api-token').value='';clearData();if(await refreshSnapshot())connectSocket();});
  $('refresh-history').addEventListener('click',loadHistory);
  window.addEventListener('online',()=>{stopSocket();refreshSnapshot().then(ok=>{if(ok)connectSocket();});});
  window.addEventListener('offline',()=>{stopSocket();connection('Sin conexión','error');renderOverview();});
  window.addEventListener('pagehide',()=>{stopSocket();model.token='';});
  setInterval(()=>{renderOverview();renderCameras();renderMap();renderLanes();renderAlerts();},5000);
  setInterval(()=>{if(model.connected)loadHistory();},30000);
  initMap();refreshSnapshot().then(ok=>{if(ok)connectSocket();});
})();
