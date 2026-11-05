import {reportDuplicateIdentity} from './report-composer.js';
export const categories=['Robo','Intento de robo','Poca iluminación','Espacio abandonado','Bache','Otro'];
export const colors=['#b75140','#bd7940','#b69a39','#7b6994','#5278a7','#64887b'];
export function classify(text){const t=text.toLowerCase(); if(/intento|intentaron|intentó/.test(t)&&/rob|asalt/.test(t))return 'Intento de robo';if(/rob|asalt/.test(t))return 'Robo';if(/ilumin|oscur|luz|luminaria/.test(t))return 'Poca iluminación';if(/abandon|baldío/.test(t))return 'Espacio abandonado';if(/bache|hoyo|hueco/.test(t))return 'Bache';return 'Otro';}
export function distance(a,b){const r=Math.PI/180;const dLat=(b.lat-a.lat)*r,dLng=(b.lng-a.lng)*r;const h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
export function duplicate(report,rows){return rows.find(r=>r.category===report.category&&(report.category!=='Otro'||reportDuplicateIdentity(r.description)===reportDuplicateIdentity(report.description))&&Math.abs(new Date(r.occurredAt)-new Date(report.occurredAt))<=3600000&&distance(r,report)<180);}
export function validate(r){if(!categories.includes(r.category))return 'Categoría inválida.';if(typeof r.description!=='string'||r.description.trim().length<12||r.description.length>600)return 'Escribe entre 12 y 600 caracteres.';if(!Number.isFinite(r.lat)||!Number.isFinite(r.lng)||Math.abs(r.lat)>90||Math.abs(r.lng)>180)return 'Selecciona una ubicación válida.';const t=Date.parse(r.occurredAt);if(!Number.isFinite(t)||t>Date.now()+60000)return 'La fecha debe ser válida y no estar en el futuro.';if(/https?:\/\/|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|(?:\d[\s()-]*){9,}/i.test(r.description))return 'No incluyas enlaces, correos ni teléfonos.';return '';}
export function period(r){const h=new Date(r.occurredAt).getHours();return h<6?'Madrugada':h<12?'Mañana':h<18?'Tarde':'Noche';}
export function routeContext(a,b,rows){const segments=40;return rows.filter(r=>{for(let i=0;i<=segments;i++){const p={lat:a.lat+(b.lat-a.lat)*i/segments,lng:a.lng+(b.lng-a.lng)*i/segments};if(distance(p,r)<250)return true;}return false;});}
export function seed(){const now=new Date();return [ ['Poca iluminación','Luminaria apagada en esta esquina.',18.478,-69.943,20],['Bache','Hoyo en el carril derecho de la avenida.',18.474,-69.934,14],['Intento de robo','Intentaron robar un bolso; reporte simulado.',18.469,-69.951,19],['Espacio abandonado','Terreno abandonado con acceso abierto.',18.486,-69.929,16],['Poca iluminación','La calle tiene varias lámparas apagadas.',18.481,-69.952,21],['Robo','Robo de un celular; ejemplo de demostración.',18.463,-69.938,18] ].map((r,i)=>{const d=new Date(now);d.setDate(d.getDate()-1);d.setHours(r[4],0,0,0);return {id:'demo-'+i,category:r[0],description:r[1],lat:r[2],lng:r[3],occurredAt:d.toISOString(),status:'approved',source:'simulated',createdAt:d.toISOString()};});}
const validCoordinate = point => point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
  && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
const routeCoordinate = point => ({lat:point?.latitude, lng:point?.longitude});

function segmentDistance(report, a, b) {
  const endpoints = Math.min(distance(report, a), distance(report, b));
  // Local projection onto each road segment; the final threshold uses meters
  // from Haversine. Keep endpoint distances for degenerate/polar segments.
  const scale = Math.cos((a.lat + b.lat + report.lat) / 3 * Math.PI / 180);
  if (Math.abs(scale) < 1e-12) return endpoints;
  const ax = a.lng * scale, bx = b.lng * scale, px = report.lng * scale;
  const dx = bx - ax, dy = b.lat - a.lat, lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return endpoints;
  const fraction = Math.max(0, Math.min(1, ((px - ax) * dx + (report.lat - a.lat) * dy) / lengthSquared));
  const nearest = {lat:a.lat + fraction * dy, lng:(ax + fraction * dx) / scale};
  const projected = distance(report, nearest);
  return Number.isFinite(projected) ? Math.min(endpoints, projected) : endpoints;
}

// Geometry only: callers decide which published records may be shared. This
// returns original records in their existing order and never alters the route.
export function reportsNearRoute(route, reports, radius = 150) {
  if (!Array.isArray(route?.points) || !Array.isArray(reports) || !Number.isFinite(radius) || radius < 0) return [];
  const points = route.points.map(routeCoordinate);
  if (!points.length) return [];
  const segments = [];
  for (let index = 1; index < points.length; index++) {
    if (validCoordinate(points[index - 1]) && validCoordinate(points[index])) segments.push([points[index - 1], points[index]]);
  }
  const singleton = points.length === 1 && validCoordinate(points[0]) ? points[0] : null;
  if (!segments.length && !singleton) return [];
  return reports.filter(report => {
    if (!validCoordinate(report)) return false;
    // Micrometer tolerance handles floating-point projections at the boundary.
    const threshold = radius + 1e-6;
    return singleton ? distance(report, singleton) <= threshold
      : segments.some(([a, b]) => segmentDistance(report, a, b) <= threshold);
  });
}

export function approvedRouteReports(route, reports, radius = 150) {
  return reportsNearRoute(route, Array.isArray(reports) ? reports.filter(report => report?.status === 'approved') : [], radius);
}

export function routeReportCount(route, reports, radius = 150) {
  return reportsNearRoute(route, reports, radius).length;
}
export function reportLevel(count){return count===0?'Sin reportes cercanos':count<=2?'Algunos reportes':'Varios reportes';}
