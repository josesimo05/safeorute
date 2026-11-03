import React from 'react';

export default function MapScheme({cases, selectedId, onSelect}) {
  return <section className="pilot-map-card" aria-label="Mapa ilustrativo">
    <div className="pilot-section-heading"><div><span className="pilot-overline">SANTO DOMINGO · PILOTO</span><h2>Mapa de incidentes</h2></div><span className="pilot-subtle-tag">Ilustrativo</span></div>
    <div className="pilot-map-scheme">
      <svg viewBox="0 0 1000 650" preserveAspectRatio="none" aria-hidden="true">
        <defs><pattern id="pilot-map-blocks" width="100" height="85" patternUnits="userSpaceOnUse"><rect x="8" y="8" width="83" height="68" rx="12" fill="#DFE9E8"/><path d="M0 0H100M0 0V85" fill="none" stroke="#FFFFFF" strokeWidth="9"/></pattern></defs>
        <rect width="1000" height="650" fill="#E9F0EA"/><rect width="1000" height="650" fill="url(#pilot-map-blocks)"/>
        <path d="M860 -40C760 95 970 200 840 345S830 550 1010 700" fill="none" stroke="#BADDE5" strokeWidth="105"/>
        <path d="M-50 510L1060 160M190 -50L565 720M-30 150L1050 570" fill="none" stroke="#CBD9D7" strokeWidth="34"/>
        <path d="M-50 510L1060 160M190 -50L565 720M-30 150L1050 570" fill="none" stroke="#FFFFFF" strokeWidth="22"/>
        <path d="M-40 510L1060 160" fill="none" stroke="#E6C26A" strokeWidth="4" strokeDasharray="12 8"/>
        <rect x="112" y="300" width="100" height="80" rx="22" fill="#B9D9C4"/><rect x="620" y="72" width="130" height="105" rx="30" fill="#B9D9C4"/>
        <text x="54" y="76" fill="#708A83" fontSize="17" fontFamily="system-ui">SECTOR DE PRUEBA A</text><text x="500" y="570" fill="#708A83" fontSize="17" fontFamily="system-ui">SECTOR DE PRUEBA B</text>
      </svg>
      {cases.map((item, index) => <button type="button" key={item.id} aria-label={`Ver caso ${item.id}: ${item.title}`} className={`pilot-map-marker ${item.priority === 'alta' ? 'is-high' : ''} ${selectedId === item.id ? 'is-selected' : ''}`} style={{left:`${item.mapX}%`, top:`${item.mapY}%`}} onClick={() => onSelect(item.id)}><span>{index + 1}</span></button>)}
      <div className="pilot-map-key"><span><i /> Reporte simulado</span><span><i className="is-high" /> Prioridad alta</span></div>
    </div>
    <p className="pilot-map-caption">Mapa ilustrativo · Ubicaciones simuladas. El esquema no representa vías ni jurisdicciones reales y no sirve para navegar.</p>
  </section>;
}
