import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import PwaControls from './PwaControls';
import PlaceSearch from './PlaceSearch';
import NavigationSession from './NavigationSession';
import { useI18n } from './LocaleContext';
import { languages } from './i18n';
import { countryOptions, normalizeCountry, countryMapView } from './regions';
import { firebaseErrorMessage } from './firebase-errors';
import { categories, colors, classify, duplicate, validate, period, routeReportCount, reportLevel } from './logic';
import { cloud, watch, watchUser, submit, moderate, reset, analyze, register, login, logout } from './store';
import { hasRouting, getRoutes, nearbyPlaces, similarRoutes, tileUrl, mapProvider, mapAttribution } from './navigation';
const poiFilters = ['Gasolineras', 'Farmacias', 'Supermercados', 'Hospitales'];
function localDay(value) {
  const d = new Date(value);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function localDate() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const initialTheme = () => {
  try {
    return localStorage.getItem('saferoute-theme') || 'light';
  } catch {
    return 'light';
  }
};
function initialCountry() {
  try {
    return normalizeCountry(localStorage.getItem('saferoute-country'));
  } catch {
    return 'all';
  }
}
export default function App() {
  const {
    t: tr,
    language,
    setLanguage
  } = useI18n();
  const [country, setCountry] = useState(initialCountry),
    [preferencesOpen, setPreferencesOpen] = useState(false);
  const countries = useMemo(() => countryOptions(language), [language]);
  const locale = country === 'all' ? language : `${language}-${country.toUpperCase()}`;
  const routeRequest = useRef(0);
  const locationRequests = useRef({origin: 0, destination: 0});
  useEffect(() => {
    try {
      localStorage.setItem('saferoute-country', country);
    } catch {}
  }, [country]);
  const [rows, setRows] = useState([]),
    [tab, setTab] = useState('Explorar'),
    [cat, setCat] = useState('Todas'),
    [time, setTime] = useState('Todas'),
    [since, setSince] = useState(''),
    [search, setSearch] = useState(''),
    [form, setForm] = useState(false),
    [point, setPoint] = useState(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [description, setDescription] = useState(''),
    [category, setCategory] = useState('Otro'),
    [date, setDate] = useState(localDate()),
    [offlineMap, setOfflineMap] = useState(false),
    [picking, setPicking] = useState(false),
    [theme, setTheme] = useState(initialTheme),
    [user, setUser] = useState(null),
    [account, setAccount] = useState(false),
    [accountMode, setAccountMode] = useState('login'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [accountError, setAccountError] = useState('');
  const [originText, setOriginText] = useState(''),
    [destText, setDestText] = useState(''),
    [origin, setOrigin] = useState(null),
    [destination, setDestination] = useState(null),
    [routes, setRoutes] = useState([]),
    [selectedRoute, setSelectedRoute] = useState(''),
    [places, setPlaces] = useState([]),
    [showPlaces, setShowPlaces] = useState(true),
    [routeBusy, setRouteBusy] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(true),
    [searchActive, setSearchActive] = useState(null);
  const [pickerPoint, setPickerPoint] = useState(null);
  const [guiding, setGuiding] = useState(false);
  const [followPosition, setFollowPosition] = useState(true);
  const [navigationPosition, setNavigationPosition] = useState(null);
  const [mapCenter, setMapCenter] = useState(() => countryMapView(country).center);
  const guidanceRef = useRef(false);
  guidanceRef.current = guiding;
  const mapNode = useRef(),
    map = useRef(),
    markers = useRef(),
    routeLayer = useRef(),
    endpointLayer = useRef(),
    poiLayer = useRef(),
    pointLayer = useRef(),
    userLayer = useRef(),
    tiles = useRef(),
    clickMode = useRef('report'),
    pickMode = useRef(null);
  const failedTiles = useRef(new Set());
  useEffect(() => {
    const stop = watch(setRows, () => setMessage('No se pudo leer Firebase. Comprueba conexión, reglas y configuración.'));
    const unwatch = watchUser(setUser);
    const net = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) tiles.current?.redraw();
    };
    addEventListener('online', net);
    addEventListener('offline', net);
    return () => {
      stop();
      unwatch();
      removeEventListener('online', net);
      removeEventListener('offline', net);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mapProvider = mapProvider;
    try {
      localStorage.setItem('saferoute-theme', theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    if (!map.current || !tiles.current) return;
    const url = tileUrl(theme);
    tiles.current.setUrl(url);
  }, [theme]);
  useEffect(() => {
    const tileStatus = e => {
      if (e.type === 'tileerror') failedTiles.current.add(e.tile);else failedTiles.current.delete(e.tile);
      setOfflineMap(failedTiles.current.size > 0);
    };
    const m = L.map(mapNode.current, {
      zoomControl: false
    }).setView(countryMapView(country).center, countryMapView(country).zoom);
    map.current = m;
    L.control.zoom({
      position: 'bottomright'
    }).addTo(m);
    tiles.current = L.tileLayer(tileUrl(theme), {
      attribution: mapAttribution,
      maxZoom: hasRouting ? 20 : 19,
      subdomains: 'abc'
    }).on('tileerror tileload tileunload', tileStatus).addTo(m);
    markers.current = L.layerGroup().addTo(m);
    routeLayer.current = L.layerGroup().addTo(m);
    endpointLayer.current = L.layerGroup().addTo(m);
    poiLayer.current = L.layerGroup().addTo(m);
    pointLayer.current = L.layerGroup().addTo(m);
    userLayer.current = L.layerGroup().addTo(m);
    m.on('moveend', () => {
      const c = m.getCenter().wrap();
      setMapCenter([c.lat, c.lng]);
      if (pickMode.current) setPickerPoint({lat:c.lat,lon:c.lng});
    });
    m.on('dragstart', () => {
      if (guidanceRef.current) setFollowPosition(false);
    });
    m.on('click', e => {
      const p = {
        lat: Number(e.latlng.wrap().lat.toFixed(6)),
        lon: Number(e.latlng.wrap().lng.toFixed(6))
      };
      if (pickMode.current) {
        m.panTo([p.lat,p.lon], {animate:false});
        setPickerPoint(p);
        return;
      }
      if (clickMode.current === 'report') {
        setPoint({
          lat: Number(p.lat.toFixed(3)),
          lng: Number(p.lon.toFixed(3))
        });
        setPicking(false);
        setForm(true);
      }
    });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => m.invalidateSize({
      pan: true, animate: false
    })) : null;
    resize?.observe(mapNode.current);
    return () => {
      resize?.disconnect();
      m.remove();
    };
  }, []);
  useEffect(() => {
    const view = countryMapView(country);
    map.current?.setView(view.center, view.zoom, {animate:false});
    setMapCenter(view.center);
  }, [country]);
  useEffect(() => {
    if (!userLayer.current) return;
    userLayer.current.clearLayers();
    if (!guiding || !navigationPosition) return;
    const p = navigationPosition;
    if (Number.isFinite(p.accuracy) && p.accuracy > 0) L.circle([p.lat,p.lon], {
      radius:p.accuracy, color:'#1678c8', weight:1, fillColor:'#359cef', fillOpacity:.12, interactive:false
    }).addTo(userLayer.current);
    L.circleMarker([p.lat,p.lon], {radius:9,color:'#fff',weight:3,fillColor:'#1678c8',fillOpacity:1,interactive:false}).addTo(userLayer.current);
    if (followPosition) map.current?.setView([p.lat,p.lon], Math.max(map.current.getZoom(), 17), {animate:false});
  }, [guiding, navigationPosition, followPosition]);
  useEffect(() => {
    if (!form && !account && !preferencesOpen) return;
    const old = document.activeElement,
      dialog = document.querySelector('[role=dialog]');
    if (!dialog) return;
    const focusable = () => Array.from(dialog.querySelectorAll('button:not(:disabled),input,select,textarea'));
    focusable()[0]?.focus();
    const key = e => {
      if (e.key === 'Escape') {
        setForm(false);
        setAccount(false);
        setPreferencesOpen(false);
      }
      if (e.key === 'Tab') {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      old?.focus();
    };
  }, [form, account, preferencesOpen]);
  const visible = rows.filter(r => r.status === 'approved' && (cat === 'Todas' || r.category === cat) && (time === 'Todas' || period(r) === time) && (!since || localDay(r.occurredAt) >= since) && r.description.toLowerCase().includes(search.toLowerCase()));
  const pending = rows.filter(r => r.status === 'pending');
  const activeRoute = routes.find(r => r.id === selectedRoute) || routes[0];
  const comparable = useMemo(() => similarRoutes(routes), [routes]);
  const comparableIds = new Set(comparable.map(r => r.id));
  const routePicking = picking && Boolean(pickMode.current);
  useEffect(() => {
    document.body.classList.toggle('immersive-map', guiding || routePicking);
    const key = event => {if (event.key === 'Escape' && routePicking) cancelMapPick();};
    document.addEventListener('keydown', key);
    return () => {document.body.classList.remove('immersive-map');document.removeEventListener('keydown',key);};
  }, [guiding, routePicking]);
  useEffect(() => {
    if (!markers.current) return;
    markers.current.clearLayers();
    visible.forEach(r => {
      const color = colors[categories.indexOf(r.category)] || colors[5],
        icon = categories[categories.indexOf(r.category)] === 'Poca iluminación' ? '☼' : categories[categories.indexOf(r.category)] === 'Bache' ? '⌁' : '!';
      const node = document.createElement('span');
      node.className = 'report-pin';
      node.textContent = icon;
      const popup = document.createElement('div'),
        strong = document.createElement('strong');
      strong.textContent = tr(r.category);
      popup.append(strong, document.createElement('br'), document.createTextNode(r.description), document.createElement('br'), document.createTextNode(new Date(r.occurredAt).toLocaleString(locale)));
      L.marker([r.lat, r.lng], {
        icon: L.divIcon({
          className: 'pin-wrap',
          html: node.outerHTML,
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        }),
        bubblingMouseEvents: false
      }).bindPopup(popup).addTo(markers.current);
    });
  }, [rows, cat, time, since, search, language]);
  useEffect(() => {
    clickMode.current = tab === 'Explorar' ? 'report' : 'ignore';
    const frame = requestAnimationFrame(() => {
      map.current?.invalidateSize({
        pan: true, animate: false
      });
      if (!picking && !guiding && activeRoute?.points.length) map.current?.fitBounds(activeRoute.points.map(p => [p.latitude, p.longitude]), {
        padding: [40, 40],
        maxZoom: 15
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, panelExpanded, picking, searchActive, guiding]);
  useEffect(() => {
    if (!pointLayer.current) return;
    pointLayer.current.clearLayers();
    if (point) L.circleMarker([point.lat, point.lng], {
      radius: 12,
      color: '#123c35',
      fillOpacity: .2
    }).addTo(pointLayer.current);
  }, [point]);
  useEffect(() => {
    if (!routeLayer.current) return;
    routeLayer.current.clearLayers();
    routes.forEach(r => {
      if (r.points.length > 1) {
        const active = r.id === (activeRoute?.id || '');
        L.polyline(r.points.map(p => [p.latitude, p.longitude]), {
          className: active ? 'route-line route-line-active' : 'route-line route-line-alternative',
          color: active ? '#247b5d' : '#879c91',
          weight: active ? 7 : 4,
          opacity: active ? 1 : .72,
          dashArray: active ? null : '7 8'
        }).addTo(routeLayer.current);
      }
    });
    if (!guiding && activeRoute?.points.length) {
      const bounds = L.latLngBounds(activeRoute.points.map(p => [p.latitude, p.longitude]));
      map.current?.fitBounds(bounds, {
        padding: [55, 55],
        maxZoom: 15
      });
    }
  }, [routes, activeRoute?.id]);
  useEffect(() => {
    if (!endpointLayer.current) return;
    endpointLayer.current.clearLayers();
    for (const [place, label, className] of [[origin, 'A', 'start-pin'], [destination, 'B', 'end-pin']]) {
      if (place) L.marker([place.lat, place.lon], {
        icon: L.divIcon({
          className: 'pin-wrap',
          html: `<span class="${className}">${label}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      }).addTo(endpointLayer.current);
    }
    if (origin && destination && !routes.length) map.current?.fitBounds([[origin.lat, origin.lon], [destination.lat, destination.lon]], {
      padding: [45, 45],
      maxZoom: 15
    });
  }, [origin, destination]);
  useEffect(() => {
    if (!activeRoute || !hasRouting) return;
    let cancelled = false;
    const pts = activeRoute.points,
      mid = pts[Math.floor(pts.length / 2)];
    nearbyPlaces({
      lat: mid.latitude,
      lon: mid.longitude
    }, {
      language
    }).then(data => {
      if (!cancelled) setPlaces(data);
    }).catch(() => {
      if (!cancelled) setPlaces([]);
    });
    return () => {
      cancelled = true;
    };
  }, [activeRoute, language]);
  useEffect(() => {
    if (!poiLayer.current) return;
    poiLayer.current.clearLayers();
    if (showPlaces) places.forEach(p => {
      const node = document.createElement('span');
      node.className = 'poi-pin';
      node.textContent = p.icon;
      const popup = document.createElement('div'),
        strong = document.createElement('strong');
      strong.textContent = p.name;
      popup.append(strong, document.createElement('br'), document.createTextNode(tr(p.type)), p.address ? document.createElement('br') : document.createTextNode(''), document.createTextNode(p.address));
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: 'pin-wrap',
          html: node.outerHTML,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        }),
        bubblingMouseEvents: false
      }).bindPopup(popup).addTo(poiLayer.current);
    });
  }, [places, showPlaces, language]);
  useEffect(() => {
    document.title = `SafeRoute · ${tr('Navega con contexto')}`;
    const zoomIn=mapNode.current?.querySelector('.leaflet-control-zoom-in');
    const zoomOut=mapNode.current?.querySelector('.leaflet-control-zoom-out');
    if(zoomIn){zoomIn.title=tr('Acercar');zoomIn.setAttribute('aria-label',tr('Acercar'));}
    if(zoomOut){zoomOut.title=tr('Alejar');zoomOut.setAttribute('aria-label',tr('Alejar'));}
  }, [language]);
  function useMyPosition(field) {
    if (!navigator.geolocation) {
      setMessage('Este navegador no ofrece geolocalización. Elige un punto en el mapa.');
      return;
    }
    // A permission prompt or GPS fix may finish after the user chooses another place.
    const requestId = ++locationRequests.current[field];
    navigator.geolocation.getCurrentPosition(pos => {
      if (requestId !== locationRequests.current[field]) return;
      const value = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        source: 'location'
      };
      routeRequest.current++;
      setRouteBusy(false);
      setSearchActive(null);
      setRoutes([]);
      setPlaces([]);
      setPicking(false);
      pickMode.current = null;
      setPanelExpanded(true);
      field === 'origin' ? (setOrigin(value), setOriginText('Mi ubicación')) : (setDestination(value), setDestText('Mi ubicación'));
      map.current?.setView([value.lat, value.lon], 15);
    }, () => {
      if (requestId === locationRequests.current[field]) setMessage('No se pudo obtener la ubicación. Selecciona el punto en el mapa.');
    }, {
      timeout: 12000,
      maximumAge: 60000
    });
  }
  function pickOnMap(field) {
    locationRequests.current[field]++;
    routeRequest.current++;
    setRouteBusy(false);
    setSearchActive(null);
    pickMode.current = field;
    const existing = field === 'origin' ? origin : destination;
    if (existing) map.current?.setView([existing.lat,existing.lon],Math.max(map.current.getZoom(),15),{animate:false});
    const c = map.current?.getCenter().wrap();
    setPickerPoint(c ? {lat:c.lat,lon:c.lng} : null);
    setPicking(true);
    setPanelExpanded(false);
    setMessage('');
    map.current?.invalidateSize();
  }
  function cancelMapPick() {
    pickMode.current = null;
    setPickerPoint(null);
    setPicking(false);
    setPanelExpanded(true);
  }
  function confirmMapPick() {
    const field = pickMode.current;
    const c = map.current?.getCenter().wrap();
    if (!field || !c) return;
    const p = {lat:Number(c.lat.toFixed(6)),lon:Number(c.lng.toFixed(6)),source:'map'};
    locationRequests.current[field]++;
    routeRequest.current++;
    setRouteBusy(false);
    if (field === 'origin') {setOrigin(p);setOriginText('Punto seleccionado en el mapa');}
    else {setDestination(p);setDestText('Punto seleccionado en el mapa');}
    setRoutes([]);
    setPlaces([]);
    setSelectedRoute('');
    cancelMapPick();
    setMessage(field === 'origin' ? 'Origen seleccionado.' : 'Destino seleccionado.');
  }
  function chooseAddress(field, result) {
    locationRequests.current[field]++;
    routeRequest.current++;
    setRouteBusy(false);
    setSearchActive(null);
    setRoutes([]);
    setPlaces([]);
    setPicking(false);
    pickMode.current = null;
    const p = {
        lat: result.position.lat,
        lon: result.position.lon
      },
      name = result.name || result.poi?.name || result.address?.freeformAddress || 'Ubicación seleccionada';
    if (field === 'origin') {
      setOrigin(p);
      setOriginText(name);
    } else {
      setDestination(p);
      setDestText(name);
    }
    map.current?.setView([p.lat, p.lon], 14);
  }
  async function calculateRoutes(e) {
    e?.preventDefault();
    if (!origin || !destination) {
      setPanelExpanded(true);
      setMessage('Escribe el nombre de cada lugar y elige una sugerencia para confirmar el origen y el destino.');
      return;
    }
    const requestId = ++routeRequest.current;
    setRouteBusy(true);
    setRoutes([]);
    setPlaces([]);
    try {
      const found = await getRoutes(origin, destination, {
        language
      });
      if (requestId !== routeRequest.current) return;
      if (!found.length) throw new Error('El servicio no encontró una ruta para esos puntos.');
      setRoutes(found);
      setSelectedRoute(found[0].id);
      map.current?.setView([origin.lat, origin.lon], 14);
      setMessage(found.length === 1 ? 'Geoapify calculó una ruta.' : `Geoapify calculó ${found.length} rutas distintas.`);
    } catch (e) {
      if (requestId === routeRequest.current) setMessage(e.message);
    } finally {
      if (requestId === routeRequest.current) setRouteBusy(false);
    }
  }
  async function locateReport() {
    if (!navigator.geolocation) {
      setMessage('Este navegador no ofrece geolocalización. Selecciona en el mapa.');
      return;
    }
    navigator.geolocation.getCurrentPosition(p => {
      const loc = {
        lat: Number(p.coords.latitude.toFixed(3)),
        lng: Number(p.coords.longitude.toFixed(3))
      };
      setPoint(loc);
      map.current.setView([loc.lat, loc.lng], 16);
      setForm(true);
    }, () => setMessage('No se pudo obtener tu ubicación. Puedes elegirla en el mapa.'), {
      timeout: 10000,
      maximumAge: 60000
    });
  }
  function quickReport(c) {
    setCategory(c);
    setDescription(c === 'Otro' ? '' : `Reporte comunitario de ${c.toLowerCase()}.`);
    setDate(localDate());
  }
  async function send(e) {
    e.preventDefault();
    if (!point) {
      setMessage('Selecciona una ubicación en el mapa.');
      return;
    }
    const r = {
      category,
      description: description.trim(),
      occurredAt: new Date(date).toISOString(),
      ...point
    };
    const error = validate(r);
    if (error) {
      setMessage(error);
      return;
    }
    if (duplicate(r, rows.filter(x => x.status !== 'rejected'))) {
      setMessage('Posible duplicado. Revisa los reportes cercanos.');
      return;
    }
    setBusy(true);
    try {
      const result = await submit(r);
      if (result) setRows(result);
      setForm(false);
      setDescription('');
      setPoint(null);
      setMessage('Reporte enviado a revisión.');
    } catch (e) {
      setMessage(firebaseErrorMessage(e, {
        guest: !user || user.isAnonymous,
        fallback: 'No se guardó el reporte. Comprueba la conexión y vuelve a intentarlo.'
      }));
    } finally {
      setBusy(false);
    }
  }
  async function ai() {
    setBusy(true);
    try {
      const result = await analyze(description);
      setCategory(result.category);
      setMessage(result.needsReview ? 'La IA recomienda revisión humana.' : 'Categoría sugerida por IA. Puedes corregirla.');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function accountSubmit(e) {
    e.preventDefault();
    setAccountError('');
    setBusy(true);
    try {
      if (accountMode === 'register') {
        await register(email, password);
        setMessage('Cuenta creada. Revisa tu correo para verificarla.');
      } else {
        await login(email, password);
        setMessage('Sesión iniciada.');
      }
      setAccount(false);
      setPassword('');
    } catch (e) {
      setAccountError(firebaseErrorMessage(e, {
        fallback: 'No se pudo acceder a tu cuenta. Inténtalo de nuevo.'
      }));
    } finally {
      setBusy(false);
    }
  }
  async function accountLogout() {
    try {
      await logout();
      setMessage('Sesión cerrada.');
    } catch {
      setMessage('No se pudo cerrar la sesión.');
    }
  }
  function speakRoute() {
    if (!activeRoute) return;
    if (!('speechSynthesis' in window)) {
      setMessage('Este navegador no tiene lectura de voz disponible.');
      return;
    }
    const n = routeReportCount(activeRoute, visible);
    const text = [tr('Ruta seleccionada.'), tr('Tiempo estimado, {minutes} minutos.', {
      minutes: Math.ceil(activeRoute.seconds / 60)
    }), n ? tr('{count} reportes comunitarios cercanos al trayecto.', {
      count: n
    }) : tr('No hay reportes aprobados cercanos en este conjunto de datos.'), tr('Mantén la atención en la vía.')].join(' ');
    const voice = new SpeechSynthesisUtterance(text);
    voice.lang = language;
    speechSynthesis.cancel();
    speechSynthesis.speak(voice);
  }
  function editPlace(field, text) {
    locationRequests.current[field]++;
    routeRequest.current++;
    setRouteBusy(false);
    setRoutes([]);
    setPlaces([]);
    setSelectedRoute('');
    if (field === 'origin') {
      setOriginText(text);
      setOrigin(null);
    } else {
      setDestText(text);
      setDestination(null);
    }
  }
  function startNavigation() {
    if (!activeRoute || routeBusy) return;
    locationRequests.current.origin++;
    locationRequests.current.destination++;
    setMessage('');
    setNavigationPosition(null);
    setFollowPosition(true);
    setSearchActive(null);
    setPanelExpanded(false);
    setGuiding(true);
  }
  function stopNavigation() {
    routeRequest.current++;
    setRouteBusy(false);
    setGuiding(false);
    setNavigationPosition(null);
    setPanelExpanded(true);
  }
  async function recalculateNavigation(position) {
    if (!position || !destination || routeBusy) return;
    const requestId = ++routeRequest.current;
    const preference = activeRoute?.id;
    setRouteBusy(true);
    try {
      const found = await getRoutes(position, destination, {language});
      if (requestId !== routeRequest.current) return;
      if (!found.length) throw new Error('El servicio no encontró una ruta para esos puntos.');
      const selected = found.find(route => route.id === preference) || found[0];
      setOrigin({...position,source:'location'});
      setOriginText('Mi ubicación');
      setRoutes(found);
      setSelectedRoute(selected.id);
      setPlaces([]);
      setMessage('Ruta actualizada desde tu ubicación.');
    } catch (error) {
      if (requestId === routeRequest.current) setMessage(error.message);
    } finally {
      if (requestId === routeRequest.current) setRouteBusy(false);
    }
  }
  function changeCountry(value) {
    const next = normalizeCountry(value);
    if (next === country) return;
    locationRequests.current.origin++;
    locationRequests.current.destination++;
    routeRequest.current++;
    setRouteBusy(false);
    setCountry(next);
    setOrigin(null);
    setDestination(null);
    setOriginText('');
    setDestText('');
    setRoutes([]);
    setPlaces([]);
    setSelectedRoute('');
    setGuiding(false);
    setNavigationPosition(null);
    setSearchActive(null);
    setPicking(false);
    pickMode.current = null;
  }
  const searchBias = origin || {
    lat: mapCenter[0],
    lon: mapCenter[1]
  };
  const mapLegend = <div className="legend">{categories.map((c, i) => <span key={c}><i className="legend-dot" style={{
        background: colors[i]
      }} />{tr(c)}</span>)}<span><i>⛽</i>{tr("Gasolinera")}</span><span><i>✚</i>{tr("Farmacia")}</span><span><i>🛒</i>{tr("Supermercado")}</span><span><i>🏥</i>{tr("Hospital")}</span><span><i className="legend-route" />{tr("Ruta elegida")}</span><span><i className="legend-start">{tr("A")}</i>{tr("Origen")}</span><span><i className="legend-end">{tr("B")}</i>{tr("Destino")}</span></div>;
  return <div className={`app-shell ${routePicking ? `route-picking route-picking-${pickMode.current}` : ''} ${guiding ? 'guidance-mode' : ''}`}><header><a className="brand" href="/" aria-label={tr("SafeRoute inicio")}><span className="brandicon">↗</span>SafeRoute<span className="branddot">.</span></a><nav aria-label={tr("Secciones")}>{['Explorar', 'Patrones', 'Navegar', ...(!cloud ? ['Moderación'] : [])].map(t => <button className={tab === t ? 'active' : ''} key={t} onClick={() => {
          setTab(t);
          setSearchActive(null);
          setPanelExpanded(true);
          setPicking(false);
          pickMode.current = null;
        }}>{tr(t)}</button>)}</nav><div className="head-actions"><button type="button" className="icon-button preferences-button" aria-label={tr("Idioma y país")} title={tr("Idioma y país")} onClick={() => setPreferencesOpen(true)}>🌐</button><button className="icon-button" aria-label={theme === 'dark' ? tr('Cambiar a tema claro') : tr('Cambiar a tema oscuro')} title={theme === 'dark' ? tr('Tema claro') : tr('Tema oscuro')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀' : '☾'}</button>{user ? <button className="account-button" onClick={accountLogout}>👤 {user.email || tr('Cerrar sesión')}</button> : <button className="account-button" onClick={() => {
          setAccountMode('login');
          setAccountError('');
          setAccount(true);
        }}>{tr("Entrar / Crear cuenta")}</button>}<button className="primary" onClick={() => {
          setForm(true);
          setPoint(null);
        }}>{tr("＋ Reportar")}</button></div></header>
 <main className={`${tab === 'Navegar' ? 'is-planning' : ''} ${!panelExpanded || picking ? 'map-focused' : ''}`}><div className="intro"><div><span className="eyebrow">{tr("INFORMACIÓN QUE NOS CONECTA")}</span><h1>{tr("Tu ciudad, con más contexto.")}</h1><p>{tr("Explora lo que comparte la comunidad. Decide cómo moverte.")}</p><div className="hero-tags"><span>{tr("⌖ Reportes comunitarios")}</span><span>{tr("✦ Rutas con contexto")}</span><span>{tr("◉ Diseñado para móvil")}</span></div></div><div className="mode"><i className={online ? 'dot' : 'dot off'} />{cloud ? tr('Comunidad · Firebase') : tr('Demostración · Datos simulados')}<small>{online ? tr('Con conexión') : tr('Sin conexión')}</small></div></div>
 <PwaControls online={online} editing={form || account || busy || picking || routeBusy || guiding} demo={!cloud} />
 <section className={`workspace ${tab === 'Navegar' ? 'navigation-workspace' : ''} ${panelExpanded ? 'panel-expanded' : 'panel-collapsed'} ${picking ? 'is-picking' : ''} ${searchActive ? 'is-searching' : ''}`}><aside><button type="button" className="panel-toggle" aria-label={panelExpanded && !picking ? tr('Ver mapa completo') : tab === 'Navegar' ? tr('Mostrar planificador') : tr('Mostrar reportes')} aria-controls="workspace-panel" aria-expanded={panelExpanded && !picking} onClick={() => {
            setSearchActive(null);
            setPanelExpanded(v => picking ? true : !v);
            setPicking(false);
            pickMode.current = null;
          }}><span>{panelExpanded && !picking ? tr('Ver mapa completo') : tab === 'Navegar' ? tr('Mostrar planificador') : tr('Mostrar reportes')}</span></button><div className="panel-content" id="workspace-panel"><div className="aside-title"><span>{tab === 'Explorar' ? tr('Explora los reportes') : tab === 'Patrones' ? tr('Observa los patrones') : tab === 'Navegar' ? tr('Navega con contexto') : tr('Revisión de prueba')}</span><small>{country === "all" ? tr("Todos los países") : countries.find(item=>item.code===country)?.name}</small></div>
 {tab === 'Navegar' && <div className="navigator"><div className="nav-note">{tr("Rutas estimadas con Geoapify y reportes comunitarios aprobados. Sin tráfico en tiempo real.")}</div><label className="planner-country" htmlFor="planner-country">{tr('País de búsqueda')}<select id="planner-country" value={country} onChange={e=>changeCountry(e.target.value)}><option value="all">{tr('Todos los países')}</option>{countries.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>{!hasRouting && <div className="setup-note">{tr("Configura Geoapify para buscar direcciones, calcular rutas y encontrar servicios cercanos. La guía del proyecto explica cómo conectar tu clave.")}</div>}<form onSubmit={calculateRoutes}>
 <PlaceSearch id="origin" label="Origen" value={origin?.source === "map" ? tr("Punto seleccionado en el mapa") : origin?.source === "location" ? tr("Mi ubicación") : originText} selected={Boolean(origin)} country={country} bias={searchBias} onChange={text => editPlace('origin', text)} onSelect={result => chooseAddress('origin', result)} onUseLocation={() => useMyPosition('origin')} onFocusChange={active => setSearchActive(active ? 'origin' : null)} onPickOnMap={() => pickOnMap('origin')} />
 <PlaceSearch id="destination" label="Destino" value={destination?.source === "map" ? tr("Punto seleccionado en el mapa") : destination?.source === "location" ? tr("Mi ubicación") : destText} selected={Boolean(destination)} country={country} bias={searchBias} onChange={text => editPlace('destination', text)} onSelect={result => chooseAddress('destination', result)} onUseLocation={() => useMyPosition('destination')} onFocusChange={active => setSearchActive(active ? 'destination' : null)} onPickOnMap={() => pickOnMap('destination')} />
 <button className="primary wide" disabled={routeBusy || !hasRouting}>{routeBusy ? tr('Calculando…') : tr('Buscar rutas')}</button>
 </form><div className="place-toggles"><b>{tr("Lugares cercanos")}</b><button onClick={() => setShowPlaces(v => !v)}>{tr(showPlaces ? 'Ocultar símbolos' : 'Mostrar símbolos')}</button></div><p className="tiny">{tr("⛽ Gasolinera ✚ Farmacia / hospital 🛒 Supermercado")}</p>
 {routes.length > 0 && <><div className="list-title"><b>{tr('{count} rutas disponibles', {
                      count: routes.length
                    })}</b><span>{tr("recomendada y más corta")}</span></div><p className="tiny">{tr("Se destacan las rutas dentro del 30% del menor tiempo estimado. Si la recomendada y la más corta coinciden, se muestra una sola.")}</p><div className="reports">{routes.map((r, i) => {
                    const n = routeReportCount(r, visible),
                      fast = Math.min(...routes.map(q => q.seconds)),
                      similar = comparableIds.has(r.id);
                    return <button className={'route-card ' + (selectedRoute === r.id ? 'selected' : '')} key={r.id} aria-pressed={selectedRoute === r.id} onClick={() => setSelectedRoute(r.id)}><span className="route-card-top"><b>{tr(r.name) || tr('Ruta {number}', {
                            number: i + 1
                          })}</b><b>{tr('{minutes} min', {
                            minutes: new Intl.NumberFormat(language).format(Math.ceil(r.seconds / 60))
                          })}</b></span><small>{tr('{distance} km · tiempo estimado', {
                          distance: new Intl.NumberFormat(language, {
                            maximumFractionDigits: 1
                          }).format(r.distance / 1000)
                        })}</small><span className="route-risk">{n === 0 ? '✓' : n <= 2 ? '!' : '‼'} {tr(reportLevel(n))} · {tr("{count} reportes a 150 m", {count:n})}{similar ? tr('· tiempo similar') : ''}</span><span className="tiny">{tr("Indicador comunitario; no predice el peligro ni verifica los hechos.")}{' '}{r.seconds <= fast * 1.3 ? '' : tr('{minutes} min sobre la ruta más rápida.', {
                          minutes: Math.ceil((r.seconds - fast) / 60)
                        })}</span></button>;
                  })}</div><button className="primary wide start-navigation" disabled={routeBusy} onClick={startNavigation}>{tr('Iniciar navegación')}</button><p className="tiny">{tr('La ruta seleccionada se mantiene dentro de SafeRoute.')}</p><details className="route-directions"><summary>{tr('Indicaciones de la ruta')}</summary><button onClick={speakRoute}>{tr('🔊 Escuchar resumen')}</button><ol>{activeRoute?.instructions.map((step,index)=><li key={index} dir="auto">{step.text}</li>)}</ol></details></>}
 </div>}
 {tab === 'Explorar' && <button type="button" className="destination-shortcut" onClick={() => {
   setTab('Navegar');
   setSearchActive(null);
   setPanelExpanded(true);
   setPicking(false);
   pickMode.current = null;
 }}><span><strong>{tr('Buscar destino')}</strong><small>{tr('Navega con contexto')}</small></span><span aria-hidden="true">↗</span></button>}
 {tab !== 'Navegar' && <><label>{tr("Buscar en los reportes")}<input placeholder={tr("Ej. luminaria, avenida…")} value={search} onChange={e => setSearch(e.target.value)} /></label><div className="filters"><label>{tr("Categoría")}<select value={cat} onChange={e => setCat(e.target.value)}><option value="Todas">{tr("Todas")}</option>{categories.map(c => <option key={c} value={c}>{tr(c)}</option>)}</select></label><label>{tr("Horario")}<select value={time} onChange={e => setTime(e.target.value)}>{['Todas', 'Madrugada', 'Mañana', 'Tarde', 'Noche'].map(t => <option key={t} value={t}>{tr(t)}</option>)}</select></label></div><label>{tr("Desde la fecha")}<input type="date" value={since} onChange={e => setSince(e.target.value)} /></label><button className="text" onClick={() => {
                setSearch('');
                setCat('Todas');
                setTime('Todas');
                setSince('');
              }}>{tr("Limpiar filtros")}</button>
 {tab === 'Explorar' && <><div className="list-title"><b>{tr('{count} reportes', {
                      count: visible.length
                    })}</b><span>{tr("en tu selección")}</span></div><div className="reports">{visible.map(r => <button className="report" key={r.id} onClick={() => map.current.setView([r.lat, r.lng], 17)}><span className="category"><i style={{
                        background: colors[categories.indexOf(r.category)]
                      }} />{tr(r.category)}</span><p>{r.description}</p><small>{new Date(r.occurredAt).toLocaleString(locale)} · {r.source === 'simulated' ? tr('Simulado') : tr('Comunitario')}</small></button>)}{!visible.length && <p>{tr("No hay reportes para estos filtros. Esto no indica que el lugar sea seguro.")}</p>}</div><button className="secondary wide" onClick={() => {
                  setTab('Navegar');
                  setPanelExpanded(true);
                }}>{tr("⌖ Planear un recorrido")}</button></>}
 {tab === 'Patrones' && <div className="stats"><h2>{tr("Por categoría")}</h2>{categories.map((c, i) => {
                  const n = visible.filter(r => r.category === c).length;
                  return <div key={c}><span>{tr(c)} <b>{n}</b></span><div className="bar"><i style={{
                        width: (visible.length ? n / visible.length * 100 : 0) + '%',
                        background: colors[i]
                      }} /></div></div>;
                })}<h2>{tr("Por horario")}</h2>{['Madrugada', 'Mañana', 'Tarde', 'Noche'].map(t => <p key={t}>{tr(t)}<b>{visible.filter(r => period(r) === t).length}</b></p>)}<small>{tr("Frecuencias de la selección actual; no miden el riesgo real.")}</small></div>}
 {tab === 'Moderación' && !cloud && <div className="moderation"><p>{tr("Simulación local para la feria. En Firebase la revisión se realiza desde la consola por el equipo autorizado.")}</p>{pending.map(r => <article key={r.id}><b>{tr(r.category)}</b><p>{r.description}</p><button onClick={() => setRows(moderate(r.id, 'approved'))}>{tr("Aprobar")}</button><button onClick={() => setRows(moderate(r.id, 'rejected'))}>{tr("Rechazar")}</button></article>)}{!pending.length && <p>{tr("No hay reportes pendientes.")}</p>}<button onClick={() => {
                  if (confirm(tr('¿Borrar los reportes locales y restaurar los ejemplos?'))) setRows(reset());
                }}>{tr("Restaurar demostración")}</button></div>}</>}
 </div></aside><div className="map-wrap"><div ref={mapNode} className="map" aria-label={tr("Mapa de reportes comunitarios y rutas")} /><div className="map-label">{picking ? tr('Toca el mapa para elegir {place}', {
              place: tr(pickMode.current === 'origin' ? 'el origen' : 'el destino')
            }) : tab === 'Navegar' ? tr('Origen A · Destino B') : tr('Toca para reportar')}</div>{(!online || offlineMap) && <div className="map-offline" role="status"><span>{online ? tr('No se pudo cargar parte del mapa. Puedes reintentarlo.') : tr('El mapa necesita conexión a internet.')}{!cloud && tr(' Tus reportes locales siguen disponibles.')}</span><button type="button" disabled={!online} onClick={() => tiles.current?.redraw()}>{tr("Reintentar mapa")}</button></div>}{tab !== 'Navegar' && <button className="locate" onClick={locateReport}>{tr("◎ Mi ubicación")}</button>}<details className="map-legend-control"><summary>{tr("Leyenda")}</summary>{mapLegend}</details>{routePicking && <><div className="picker-crosshair" aria-hidden="true"><span>{pickMode.current === 'origin' ? 'A' : 'B'}</span></div><section className="map-picker" aria-label={tr(pickMode.current === 'origin' ? 'Mover el mapa para elegir el origen' : 'Mover el mapa para elegir el destino')}><div className="picker-heading"><strong>{tr(pickMode.current === 'origin' ? 'Mover el mapa para elegir el origen' : 'Mover el mapa para elegir el destino')}</strong><button type="button" onClick={cancelMapPick}>{tr('Cancelar selección')}</button></div><div className="picker-confirm"><p>{tr('Arrastra el mapa y coloca el punto bajo la mira.')}{pickerPoint && <small dir="ltr">{pickerPoint.lat.toFixed(5)}, {pickerPoint.lon.toFixed(5)}</small>}</p><button type="button" className="primary" onClick={confirmMapPick}>{tr(pickMode.current === 'origin' ? 'Confirmar origen' : 'Confirmar destino')}</button></div></section></>}{guiding && activeRoute && <NavigationSession route={activeRoute} onPosition={setNavigationPosition} onStop={stopNavigation} onRecalculate={recalculateNavigation} follow={followPosition} onFollowChange={setFollowPosition} onOverview={() => {
  setFollowPosition(false);
  const height=map.current?.getSize().y || 800;
  map.current?.fitBounds(activeRoute.points.map(p=>[p.latitude,p.longitude]), {paddingTopLeft:[30,Math.min(200,height*.27)],paddingBottomRight:[30,Math.min(250,height*.34)],maxZoom:16});
}} recalculating={routeBusy} />}</div></section>
 <footer><p>{tr("Los reportes comunitarios no están verificados. SafeRoute no determina si una zona es segura. Conduce y reporta sólo cuando el vehículo esté detenido.")}</p><span>JMMM × Actuana Academy · INTEC STEM</span></footer></main>
 {message && <div className="toast" role="status">{tr(message)}<button aria-label={tr("Cerrar aviso")} onClick={() => setMessage('')}>×</button></div>}
 {form && <div className="overlay"><section role="dialog" aria-modal="true" aria-labelledby="report-title" className="dialog"><button className="close" aria-label={tr("Cerrar formulario")} onClick={() => setForm(false)}>×</button><span className="eyebrow">{tr("TU APORTE CUENTA")}</span><h2 id="report-title">{tr("Registra un incidente")}</h2><p>{tr("No incluyas nombres, rostros, teléfonos ni otros datos personales.")}</p><form onSubmit={send}><div className="quick-label">{tr("Reporte rápido")}<small>{tr("elige el tipo y marca el lugar")}</small></div><div className="quick-choices">{categories.map((c, i) => <button type="button" key={c} className={category === c ? 'quick-selected' : ''} aria-pressed={category === c} onClick={() => quickReport(c)}><i style={{
                background: colors[i]
              }} />{tr(c)}</button>)}</div><label>{tr("Detalle opcional")}<textarea minLength={description ? 12 : 0} maxLength={600} placeholder={tr("Si hace falta, añade un detalle sin identificar a nadie…")} value={description} onChange={e => setDescription(e.target.value)} /></label><div className="assist"><button type="button" onClick={() => {
              setCategory(classify(description));
              setMessage('Sugerencia por palabras clave. Puedes corregirla.');
            }}>{tr("Sugerir categoría")}</button><button type="button" disabled={busy || description.length < 12} onClick={ai}>{tr("Analizar con IA")}</button></div><label>{tr("Categoría")}<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c} value={c}>{tr(c)}</option>)}</select></label><label>{tr("Fecha y hora del incidente")}<input type="datetime-local" required max={localDate()} value={date} onChange={e => setDate(e.target.value)} /></label><label>{tr("Ubicación aproximada")}</label><p className="location-value">{point ? `${point.lat.toFixed(3)}, ${point.lng.toFixed(3)}` : tr('No seleccionada')}</p><div className="assist"><button type="button" onClick={() => {
              setForm(false);
              setPicking(true);
              setTab('Explorar');
            }}>{tr("Elegir en el mapa")}</button><button type="button" onClick={locateReport}>{tr("Usar mi ubicación")}</button></div><small>{tr("Coordenadas aproximadas. No incluimos tu nombre en reportes públicos.")}</small><button className="primary wide" disabled={busy} type="submit">{busy ? tr('Procesando…') : tr('Enviar a revisión')}</button></form></section></div>}
 {preferencesOpen && <div className="overlay"><section role="dialog" aria-modal="true" aria-labelledby="preferences-title" className="dialog preferences-dialog"><button className="close" aria-label={tr("Cerrar preferencias")} onClick={() => setPreferencesOpen(false)}>×</button><h2 id="preferences-title">{tr("Idioma y país")}</h2><label>{tr("Idioma de la aplicación")}<select id="app-language" value={language} onChange={e => setLanguage(e.target.value)}>{languages.map(item => <option key={item.code} value={item.code}>{item.nativeName}</option>)}</select></label><p className="tiny">{tr("Versión sin conexión en ocho idiomas.")}</p><label>{tr("País de búsqueda")}<select id="search-country" value={country} onChange={e => changeCountry(e.target.value)}><option value="all">{tr("Todos los países")}</option>{countries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label><small>{tr("Cambiar el país borra el origen y el destino actuales.")}</small><p className="tiny">{tr("Los nombres de lugares y los reportes se muestran en su idioma original.")}</p><div className="preferences-account">{user ? <button onClick={accountLogout}>{tr("Cerrar sesión")}</button> : <button onClick={() => {
            setPreferencesOpen(false);
            setAccountMode('login');
            setAccountError('');
            setAccount(true);
          }}>{tr("Entrar / Crear cuenta")}</button>}</div><button className="primary wide" onClick={() => setPreferencesOpen(false)}>{tr("Guardar preferencias")}</button></section></div>}
 {account && <div className="overlay"><section role="dialog" aria-modal="true" aria-labelledby="account-title" className="dialog account-dialog"><button className="close" aria-label={tr("Cerrar")} onClick={() => setAccount(false)}>×</button><span className="eyebrow">{tr("SAFE ROUTE · TU CUENTA")}</span><h2 id="account-title">{accountMode === 'login' ? tr('Qué bueno verte') : tr('Crea tu cuenta')}</h2><p>{tr("Tu correo no se publica en los reportes comunitarios.")}</p><form onSubmit={accountSubmit}><label>{tr("Correo electrónico")}<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder={tr("tu@correo.com")} /></label><label>{tr("Contraseña")}<input type="password" minLength="6" autoComplete={accountMode === 'login' ? 'current-password' : 'new-password'} required value={password} onChange={e => setPassword(e.target.value)} placeholder={tr("Al menos 6 caracteres")} /></label>{accountError && <p className="form-error" role="alert">{tr(accountError)}</p>}<button className="primary wide" disabled={busy || !cloud}>{busy ? tr('Un momento…') : accountMode === 'login' ? tr('Iniciar sesión') : tr('Crear cuenta')}</button>{!cloud && <small className="form-error">{tr("Conecta Firebase y activa el proveedor Correo/contraseña para usar cuentas.")}</small>}</form><button className="text account-switch" onClick={() => {
          setAccountMode(accountMode === 'login' ? 'register' : 'login');
          setAccountError('');
        }}>{accountMode === 'login' ? tr('¿No tienes cuenta? Regístrate') : tr('¿Ya tienes cuenta? Inicia sesión')}</button></section></div>}
 </div>;
}
