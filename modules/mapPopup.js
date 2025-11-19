import { getCurrentIndex, getFileMetadata, getFileList, getFileIconState } from './fileState.js';
import { showMessageBox } from './messageBox.js';
import { Dropdown } from './dropdown.js';
import MarkerClusteringManager from './markerClusteringManager.js';

let importKmlFileFn = null;
let clusterManager = null;
let surveyPointsDataPending = false; // Track if survey points data needs to be loaded
let surveyPointsLoaded = false; // Track if survey points have been successfully loaded

export function initMapPopup({
  buttonId = 'mapBtn',
  popupId = 'mapPopup',
  mapId = 'map'
} = {}) {
  const btn = document.getElementById(buttonId);
  const popup = document.getElementById(popupId);
  const mapDiv = document.getElementById(mapId);
  const viewer = document.getElementById('viewer-container');
  const controlBar = document.getElementById('control-bar');
  const sidebar = document.getElementById('sidebar');
  const dragBar = popup.querySelector('.popup-drag-bar');
  const closeBtn = popup.querySelector('.popup-close-btn');
  const minBtn = popup.querySelector('.popup-min-btn');
  const maxBtn = popup.querySelector('.popup-max-btn');
  if (!btn || !popup || !mapDiv) return;
  mapDiv.style.cursor = 'default';

  const edgeThreshold = 5;

  function getEdgeState(clientX, clientY) {
    const rect = popup.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
  
    const withinVertical = y >= -edgeThreshold && y <= rect.height + edgeThreshold;
    const withinHorizontal = x >= -edgeThreshold && x <= rect.width + edgeThreshold;
  
    const onLeft   = Math.abs(x - 0) <= edgeThreshold && withinVertical;
    const onRight  = Math.abs(x - rect.width) <= edgeThreshold && withinVertical;
    const onTop    = Math.abs(y - 0) <= edgeThreshold && withinHorizontal;
    const onBottom = Math.abs(y - rect.height) <= edgeThreshold && withinHorizontal;
  
    return { onLeft, onRight, onTop, onBottom };
  }

  function edgeCursor(state) {
    const { onLeft, onRight, onTop, onBottom } = state;
    let cursor = '';
    if ((onLeft && onTop) || (onRight && onBottom)) {
      cursor = 'nwse-resize';
    } else if ((onRight && onTop) || (onLeft && onBottom)) {
      cursor = 'nesw-resize';
    } else if (onLeft || onRight) {
      cursor = 'ew-resize';
    } else if (onTop || onBottom) {
      cursor = 'ns-resize';
    }
    return cursor;
  }
  let popupWidth = parseInt(localStorage.getItem('mapPopupWidth'), 10);
  let popupHeight = parseInt(localStorage.getItem('mapPopupHeight'), 10);
  if (isNaN(popupWidth) || popupWidth <= 0) popupWidth = 600;
  if (isNaN(popupHeight) || popupHeight <= 0) popupHeight = 600;
  popup.style.width = `${popupWidth}px`;
  popup.style.height = `${popupHeight}px`;

  let map = null;
  let markers = [];
  // track survey markers whose tooltip was pinned (should remain visible)
  let pinnedSurveyMarkers = new Set();
  let polylines = [];
  let routeBtn = null;
  let routeToggleBtn = null;
  let routeBtnGroup = null;
  let kmlPolylines = [];
  let importBtn = null;
  let clearKmlBtn = null;
  let clearTextBtn = null;
  let drawBtn = null;
  let textBtn = null;
  let professionalBtn = null;
  let exportBtn = null;
  let textMode = false;
  let textMarkers = [];
  let activeTextInput = null;
  let suppressNextTextClick = false;
  let drawControl = null;
  let drawnItems = null;
  let drawControlVisible = false;
  let layersControl = null;
  let hkgridLayer = null;
  // overlays handling (moved to outer scope so togglePopup can access)
  let overlaysPending = []; // { layer, name }
  let overlaysLoaded = false; // whether overlays have been added to layersControl
  let overlaysPromptShown = false; // whether we already showed the password prompt (only show once)
  const HASHED_PASSWORD = '8e81149cfda80214b01f32e8e96ede43ee9c42b797e7af1c5c979429622ce40c';

  function loadOverlays() {
    if (overlaysLoaded) return;
    overlaysPending.forEach(({ layer, name }) => {
      try {
        layersControl.addOverlay(layer, name);
      } catch (e) {
        // ignore
      }
    });
    overlaysPending = [];
    overlaysLoaded = true;
    // hide professional control if present
    try {
      if (professionalBtn?.parentElement) {
        professionalBtn.parentElement.style.display = 'none';
      }
    } catch (e) {}
    // Load survey points data after password is verified
    if (!surveyPointsLoaded && !surveyPointsDataPending) {
      loadSurveyPointsData();
    }
  }

  // Load survey points data from remote source
  function loadSurveyPointsData() {
    if (surveyPointsDataPending || surveyPointsLoaded) return;
    surveyPointsDataPending = true;
    
    fetch("https://opensheet.elk.sh/1Al_sWwiIU6DtQv6sMFvXb9wBUbBiE-zcYk8vEwV82x8/sheet3")
      .then(r => r.json())
      .then(points => {
        // Initialize clustering manager if not already done
        if (!clusterManager) {
          clusterManager = new MarkerClusteringManager(map, {
            maxVisibleMarkers: 500,
            enableAnimation: true,
            animationDuration: 300,
          });
        }

        // Format data for clustering system
        const formattedPoints = points
          .filter(pt => {
            const lat = parseFloat(pt.Latitude);
            const lon = parseFloat(pt.Longitude);
            return !isNaN(lat) && !isNaN(lon);
          })
          .map((pt, idx) => ({
            id: `survey_${idx}`,
            lat: parseFloat(pt.Latitude),
            lng: parseFloat(pt.Longitude),
            location: pt.Location,
          }));

        // Set survey points in clustering manager
        clusterManager.setSurveyPoints(formattedPoints);
        
        // Add single Survey point overlay that dynamically shows clusters or markers based on zoom
        try {
          // Create a combined layer group that will be managed dynamically
          const surveyPointLayer = L.layerGroup();
          
          if (layersControl) {
            layersControl.addOverlay(surveyPointLayer, 'Survey point');
          }
          
          // Function to update layer visibility based on zoom level
          const updateSurveyPointLayers = () => {
            if (!map.hasLayer(surveyPointLayer)) return; // Only update if overlay is checked
            
            const clusterLayerGroup = clusterManager.getClusterLayerGroup();
            const markerLayerGroup = clusterManager.getMarkerLayerGroup();
            
            // 在清除前，保存 pinned markers 資訊
            const pinnedMarkersData = [];
            surveyPointLayer.eachLayer(layer => {
              if (layer._tooltipPinned && layer._pinnedIsPopup) {
                pinnedMarkersData.push({
                  id: layer._surveyPointData?.id,
                  shouldReopen: true
                });
              }
            });
            
            surveyPointLayer.clearLayers();
            
            const isClustered = clusterManager.isClustered;
            
            console.log(`[MapPopup] updateSurveyPointLayers: isClustered=${isClustered}, clusters=${clusterManager.currentClusters?.length || 0}, visibleMarkers=${clusterManager.currentVisibleMarkers?.length || 0}`);
            
            if (isClustered && clusterLayerGroup) {
              clusterLayerGroup.eachLayer(layer => {
                surveyPointLayer.addLayer(layer);
              });
            } else if (!isClustered && markerLayerGroup) {
              markerLayerGroup.eachLayer(layer => {
                surveyPointLayer.addLayer(layer);
              });
            }
            
            // Sync pinned markers from clusterManager after layers are updated
            if (clusterManager.getPinnedMarkers) {
              pinnedSurveyMarkers = clusterManager.getPinnedMarkers();
              // 重新打開所有 pinned popups（因為層重新添加時 popup 會被關閉）
              setTimeout(() => {
                pinnedSurveyMarkers.forEach(m => {
                  try {
                    if (m?._tooltipPinned && m._pinnedIsPopup) {
                      m.openPopup();
                    }
                  } catch (e) {}
                });
              }, 20);
            }
          };
          
          // Listen to map events to update layers dynamically
          map.on('zoomend', updateSurveyPointLayers);
          map.on('moveend', updateSurveyPointLayers);
          
          // Listen to overlay toggle
          map.on('overlayadd', (e) => {
            if (e.name === 'Survey point') {
              updateSurveyPointLayers();
            }
          });
          
          // Store reference for later use
          clusterManager.surveyPointLayer = surveyPointLayer;
          clusterManager.updateSurveyPointLayers = updateSurveyPointLayers;
        } catch (e) {
          console.error('[MapPopup] Error adding survey point overlay:', e);
        }
        
        surveyPointsLoaded = true;
        surveyPointsDataPending = false;
        console.log('[MapPopup] Survey points loaded successfully');
      })
      .catch(err => {
        console.error('[MapPopup] Error loading survey points:', err);
        surveyPointsDataPending = false;
      });
  }

  async function computeSHA256Hex(text) {
    try {
      const enc = new TextEncoder().encode(text);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      return hex;
    } catch (e) {
      return null;
    }
  }

  // Deprecated automatic prompt. We won't auto-prompt when popup opens.
  function promptForPasswordIfNeeded() {
    // intentionally no-op to prevent automatic popup on map open
  }

  // Show professional password prompt on-demand (triggered by the Professional button)
  async function showProfessionalPrompt() {
    try {
      overlaysPromptShown = true;
      const showPasswordPrompt = () => {
        showMessageBox({
          title: 'Professional option',
          message: 'To access more layers, please enter password.',
          confirmText: 'Confirm',
          cancelText: 'Cancel',
          input: true,
          inputType: 'password',
          onConfirm: async (val) => {
            const hex = await computeSHA256Hex(val || '');
            if (hex && hex === HASHED_PASSWORD) {
              loadOverlays();
              // hide professional button if present
              try {
                if (professionalBtn) {
                  const parent = professionalBtn.parentElement;
                  if (parent) parent.style.display = 'none';
                }
              } catch (e) {}
            } else {
              showMessageBox({
                message: 'Wrong password',
                confirmText: 'OK',
                onConfirm: () => {
                  showPasswordPrompt();
                }
              });
            }
          },
          onCancel: () => {
          }
        });
      };
      showPasswordPrompt();
    } catch (e) {
      // ignore
    }
  }
  const coordScaleWrapper = mapDiv.querySelector('.coord-scale-wrapper');
  const coordDisplay = mapDiv.querySelector('#coord-display');
  const noCoordMsg = mapDiv.querySelector('#no-coord-message');
  const copyCoordMsg = mapDiv.querySelector('#copy-coord-message');
  let copyMsgTimer = null;
  let scaleControl = null;
  let isMapDragging = false;
  let isMapZooming = false; // Track if map is zooming
  let layersControlContainer = null;
  let zoomControlContainer = null;
  let routeToggleContainer = null;
  let exportControlContainer = null;
  let textToggleContainer = null;
  const kmlInput = document.createElement('input');
  kmlInput.type = 'file';
  kmlInput.accept = '.kml';
  kmlInput.style.display = 'none';
  popup.appendChild(kmlInput);
  const mapDropOverlay = document.getElementById('map-drop-overlay');
  let dropCounter = 0;

  let ctrlPressed = false;
  let markerPointerSuppressed = false; // 當拖動/縮放期間暫時抑制 marker tooltip

  function updateMarkerPointerEvents() {
    // 如果被全域抑制（drag/zoom），則不要改變 pointerEvents
    if (markerPointerSuppressed) return;
    const all = [...markers, ...textMarkers];
    all.forEach(m => {
      const el = m.getElement ? m.getElement() : m._icon;
      if (el) {
        el.style.pointerEvents = ctrlPressed ? 'none' : '';
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control' && !ctrlPressed) {
      ctrlPressed = true;
      updateMarkerPointerEvents();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && ctrlPressed) {
      ctrlPressed = false;
      updateMarkerPointerEvents();
    }
  });

  function updateCursor() {
    if (isMapDragging) {
      mapDiv.style.cursor = 'grabbing';
    } else if (textMode) {
      mapDiv.style.cursor = 'text';
    } else {
      mapDiv.style.cursor = 'default';
    }
  }

  function showMapDropOverlay() {
    if (mapDropOverlay) {
      mapDropOverlay.style.display = 'flex';
      mapDropOverlay.style.pointerEvents = 'auto';
    }
    map?.dragging.disable();
  }

  function hideMapDropOverlay() {
    if (mapDropOverlay) {
      mapDropOverlay.style.display = 'none';
      mapDropOverlay.style.pointerEvents = 'none';
    }
    map?.dragging.enable();
  }

  function showNoCoordMessage() {
    if (noCoordMsg) noCoordMsg.style.display = 'flex';
  }

  function hideNoCoordMessage() {
    if (noCoordMsg) noCoordMsg.style.display = 'none';
  }

  function showCopyCoordMessage() {
    if (!copyCoordMsg) return;
    copyCoordMsg.style.display = 'flex';
    clearTimeout(copyMsgTimer);
    copyMsgTimer = setTimeout(() => {
      copyCoordMsg.style.display = 'none';
    }, 3000);
  }

  mapDiv.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types?.includes('Files')) return;
    e.preventDefault();
    dropCounter++;
    showMapDropOverlay();
  });

  mapDiv.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  mapDiv.addEventListener('dragleave', (e) => {
    if (!e.dataTransfer.types?.includes('Files')) return;
    e.preventDefault();
    dropCounter--;
    if (dropCounter <= 0) hideMapDropOverlay();
  });

  mapDiv.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropCounter = 0;
    hideMapDropOverlay();
    const file = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.kml'));
    if (file) {
      await importKml(file);
    }
  });

  function createMap(lat, lon) {
    map = L.map(mapDiv).setView([lat, lon], 13);
    // ensure pinned survey markers remain visible even if other clicks close tooltips/popups
    map.on('click', () => {
      try {
        // 如果地圖正在被使用者拖曳，則不要自動重新開啟 pinned tooltip/popup
        if (isMapDragging) return;
        pinnedSurveyMarkers.forEach(m => {
          try {
            if (m?._tooltipPinned) {
              if (m._pinnedIsPopup) m.openPopup(); else m.openTooltip();
            }
          } catch (e) {}
        });
      } catch (e) {}
    });
    // also listen for clicks outside the map (document) to re-open pinned displays
    document.addEventListener('click', () => {
      try {
        // 如果使用者正在拖曳地圖，避免在全域點擊事件中重新開啟 pinned tooltip/popup
        if (isMapDragging) return;
        pinnedSurveyMarkers.forEach(m => {
          try {
            if (m?._tooltipPinned) {
              if (m._pinnedIsPopup) m.openPopup(); else m.openTooltip();
            }
          } catch (e) {}
        });
      } catch (e) {}
    });
    // Protect pinned tooltips/popups: if Leaflet emits close events for pinned layers,
    // immediately re-open them so they remain visible when other markers are clicked.
    if (map && map.on) {
      map.on('tooltipclose', (e) => {
        try {
          // 在使用者拖曳地圖時，不要強制重新開啟 tooltip（以免觸發自動平移）
          if (isMapDragging) return;
          const layer = e.layer || (e.tooltip && e.tooltip._source) || null;
          if (layer && pinnedSurveyMarkers.has(layer) && layer._tooltipPinned && !layer._pinnedIsPopup) {
            setTimeout(() => {
              try { if (layer._tooltipPinned) layer.openTooltip(); } catch (err) {}
            }, 0);
          }
        } catch (err) {}
      });
      map.on('popupclose', (e) => {
        try {
          // 在使用者拖曳或縮放地圖時，不要強制移除或重新開啟 popup
          // 如果 popup 是 pinned，應該保持開啟直到用戶手動取消 pin
          if (isMapDragging || isMapZooming) return;
          const layer = e.layer || (e.popup && e.popup._source) || (e.popup && e.popup._source) || null;
          if (layer && pinnedSurveyMarkers.has(layer) && layer._tooltipPinned && layer._pinnedIsPopup) {
            // 如果是 pinned popup，重新開啟
            setTimeout(() => {
              try { if (layer._tooltipPinned) layer.openPopup(); } catch (err) {}
            }, 0);
          }
        } catch (err) {}
      });
    }
    // 當拖動或縮放時，不要顯示 marker 的 tooltip (全域抑制)
    function setAllMarkersPointerEvents(enabled) {
      try {
        markerPointerSuppressed = enabled ? false : true;
        // top-level markers & text markers
        const all = [...markers, ...textMarkers];
        all.forEach(m => {
          const el = m.getElement ? m.getElement() : m._icon;
          if (el) el.style.pointerEvents = enabled ? '' : 'none';
        });
        // surveyPointLayer (若存在)
        if (typeof surveyPointLayer !== 'undefined' && surveyPointLayer && surveyPointLayer.eachLayer) {
          surveyPointLayer.eachLayer(l => {
            const el = l.getElement ? l.getElement() : l._icon;
            if (el) el.style.pointerEvents = enabled ? '' : 'none';
          });
        }
      } catch (e) {}
    }
    map.createPane('annotationPane');
    map.getPane('annotationPane').style.zIndex = 650;
    zoomControlContainer = map.zoomControl.getContainer();
  map.on('dragstart', () => { isMapDragging = true; setAllMarkersPointerEvents(false); updateCursor(); });
  map.on('dragend', () => { isMapDragging = false; setAllMarkersPointerEvents(true); updateCursor(); });
  // 當使用者開始/結束縮放時也暫時設置標誌以保護 pinned popups
  map.on('zoomstart', () => { isMapZooming = true; setAllMarkersPointerEvents(false); });
  map.on('zoomend', () => { isMapZooming = false; setAllMarkersPointerEvents(true); });
    updateCursor();
    scaleControl = L.control.scale({
      position: 'bottomleft',
      metric: true,
      imperial: false,
    }).addTo(map);
    if (coordScaleWrapper) {
      const scaleEl = scaleControl.getContainer();
      scaleEl.style.position = 'static';
      coordScaleWrapper.appendChild(scaleEl);
    }
    function updateCoords(latlng) {
      if (!coordDisplay) return;
      const { lat, lng } = latlng;
      coordDisplay.textContent = `${lat.toFixed(4)} ${lng.toFixed(4)}`;
    }
    map.on('mousemove', (e) => updateCoords(e.latlng));
    map.on('move', () => updateCoords(map.getCenter()));
    updateCoords(map.getCenter());

    map.on('contextmenu', (e) => {
      const { lat, lng } = e.latlng;
      const text = `${lat.toFixed(6)}\t${lng.toFixed(6)}`;
      navigator.clipboard?.writeText(text).catch(() => {});
      showCopyCoordMessage();
    });

    const osmAttr = { attribution: '&copy; OpenStreetMap contributors' };
    const esriAttr = { attribution: '&copy; Esri' };
    const cartoAttr = { attribution: '&copy; CARTO' };
    const googleAttr = { attribution: '&copy; Google' };
    const imageryAttr = { attribution: '&copy; HKSAR Government' };
    const landsdAttr = { attribution: '&copy; HKSAR Government' };

    const streets = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { ...osmAttr, crossOrigin: 'anonymous' }
    ).addTo(map);
    const esriSatellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { ...esriAttr, crossOrigin: 'anonymous' }
    );
    const cartoLight = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { ...cartoAttr, crossOrigin: 'anonymous' }
    );
    const cartoDark = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { ...cartoAttr, crossOrigin: 'anonymous' }
    );
    const googleStreets = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      { ...googleAttr, crossOrigin: 'anonymous' }
    );
    const googleSatellite = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      { ...googleAttr, crossOrigin: 'anonymous' }
    );
    const googleHybrid = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      { ...googleAttr, crossOrigin: 'anonymous' }
    );

    const hkImageryLayer = L.tileLayer(
      'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/imagery/wgs84/{z}/{x}/{y}.png',
      { ...imageryAttr, minZoom: 0, maxZoom: 19, crossOrigin: 'anonymous' }
    );

    const hkVectorBase = L.tileLayer(
      'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png',
      { ...landsdAttr, maxZoom: 20, minZoom: 10, crossOrigin: 'anonymous' }
    );

    const hkVectorLabel = L.tileLayer(
      'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/en/wgs84/{z}/{x}/{y}.png',
      { attribution: false, maxZoom: 20, minZoom: 0, crossOrigin: 'anonymous' }
    );

    // separate label layer is required for the imagery group so that
    // changing basemaps does not inadvertently remove the shared label layer
    const hkImageryLabel = L.tileLayer(
      'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/en/wgs84/{z}/{x}/{y}.png',
      { attribution: false, maxZoom: 20, minZoom: 0, crossOrigin: 'anonymous' }
    );


    // Google Terrain
    const googleTerrain = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
      {
        attribution: 'Map data ©2025 Google',
        crossOrigin: 'anonymous'
      }
    );

    const hkVectorGroup = L.layerGroup([hkVectorBase, hkVectorLabel]);
    const hkImageryGroup = L.layerGroup([hkImageryLayer, hkImageryLabel]);

    map.on('zoomend', () => {
      const currentZoom = map.getZoom();
      if (currentZoom > 19 && map.hasLayer(hkImageryGroup)) {
        map.setZoom(19);
      }
    });

    const baseLayers = {
      'OpenStreetMap': streets,
      'Esri Satellite': esriSatellite,
      'Carto Light': cartoLight,
      'Carto Dark': cartoDark,
      'Google Streets': googleStreets,
      'Google Satellite': googleSatellite,
  'Google Hybrid': googleHybrid,
  'Google Terrain': googleTerrain,
  'HK Vector': hkVectorGroup,
  'HK Imagery': hkImageryGroup,
    };

    layersControl = L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
    layersControlContainer = layersControl.getContainer();

    fetch("https://raw.githubusercontent.com/hkbatradar/SonoRadar/main/hkgrid.geojson")
      .then((r) => r.json())
      .then((hkgriddata) => {
        hkgridLayer = L.geoJSON(hkgriddata, {
          interactive: false,
          style: {
            color: '#3388ff',
            weight: 2,
            fillColor: '#3388ff',
            fillOpacity: 0,
          },
        });
        // postpone adding overlay to control until authorized
        overlaysPending.push({ layer: hkgridLayer, name: '1km Grid' });
        // if popup is already open, prompt now
        promptForPasswordIfNeeded();
      });

    drawnItems = new L.FeatureGroup().addTo(map);
    const canvasRenderer = L.canvas({ pane: 'annotationPane' });
    drawControl = new L.Control.Draw({
      position: 'topleft',
      edit: { featureGroup: drawnItems },
      draw: {
        circlemarker: false,
        polyline: {},
        polygon: {},
        rectangle: {},
        circle: {}
      }
    });
    map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.addLayer(e.layer);
    });

    const RouteToggleControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-route-toggle-control');
        container.style.display = 'flex';

        const toggle = L.DomUtil.create('a', '', container);
        toggle.href = '#';
        toggle.title = 'Route options';
        toggle.innerHTML = '<i class="fa-solid fa-route"></i>';
        routeToggleBtn = toggle;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);

        routeBtnGroup = L.DomUtil.create('div', 'route-button-group', container);
        routeBtnGroup.style.display = 'none';

        const createLink = L.DomUtil.create('a', '', routeBtnGroup);
        createLink.href = '#';
        createLink.title = 'Create Route';
        createLink.innerHTML = '<i class="fa-solid fa-eye"></i>';
        routeBtn = createLink;
        L.DomEvent.on(createLink, 'click', L.DomEvent.stop)
          .on(createLink, 'mousedown', L.DomEvent.stopPropagation)
          .on(createLink, 'dblclick', L.DomEvent.stopPropagation)
          .on(createLink, 'click', toggleRoute);

        const importLink = L.DomUtil.create('a', '', routeBtnGroup);
        importLink.href = '#';
        importLink.title = 'Import KML';
        importLink.innerHTML = '<i class="fa-solid fa-file-import"></i>';
        importBtn = importLink;
        L.DomEvent.on(importLink, 'click', L.DomEvent.stop)
          .on(importLink, 'mousedown', L.DomEvent.stopPropagation)
          .on(importLink, 'dblclick', L.DomEvent.stopPropagation)
          .on(importLink, 'click', () => { kmlInput.value = ''; kmlInput.click(); });

        const clearLink = L.DomUtil.create('a', '', routeBtnGroup);
        clearLink.href = '#';
        clearLink.title = 'Clear KML';
        clearLink.innerHTML = '<i class="fa-solid fa-trash"></i>';
        clearKmlBtn = clearLink;
        L.DomEvent.on(clearLink, 'click', L.DomEvent.stop)
          .on(clearLink, 'mousedown', L.DomEvent.stopPropagation)
          .on(clearLink, 'dblclick', L.DomEvent.stopPropagation)
          .on(clearLink, 'click', clearKmlRoute);

        L.DomEvent.on(toggle, 'click', L.DomEvent.stop)
          .on(toggle, 'mousedown', L.DomEvent.stopPropagation)
          .on(toggle, 'dblclick', L.DomEvent.stopPropagation)
          .on(toggle, 'click', () => {
            const visible = routeBtnGroup.style.display === 'flex';
            routeBtnGroup.style.display = visible ? 'none' : 'flex';
            toggle.classList.toggle('active', !visible);
          });

        return container;
      }
    });
    const routeControl = new RouteToggleControl();
    map.addControl(routeControl);
    routeToggleContainer = routeControl.getContainer();

    const TextToggleControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-text-toggle-control');
        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Text';
        link.innerHTML = '<i class="fa-solid fa-font"></i>';
        textBtn = link;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'mousedown', L.DomEvent.stopPropagation)
          .on(link, 'dblclick', L.DomEvent.stopPropagation)
          .on(link, 'click', toggleTextMode);

        // Clear Text button (same style as text toggle control)
        const clearLink = L.DomUtil.create('a', '', container);
        clearLink.href = '#';
        clearLink.title = 'Clear Text';
        clearLink.innerHTML = '<i class="fa-solid fa-broom"></i>';
        clearTextBtn = clearLink;
        L.DomEvent.on(clearLink, 'click', L.DomEvent.stop)
          .on(clearLink, 'mousedown', L.DomEvent.stopPropagation)
          .on(clearLink, 'dblclick', L.DomEvent.stopPropagation)
          .on(clearLink, 'click', (ev) => {
            try {
              ev.preventDefault();
            } catch (e) {}
            showMessageBox({
              message: 'Confirm to clear all text?',
              confirmText: 'Confirm',
              cancelText: 'Cancel',
              onConfirm: () => {
                try {
                  // remove all text markers from map
                  textMarkers.forEach(m => {
                    try { if (map && m) map.removeLayer(m); } catch (e) {}
                  });
                  textMarkers = [];
                  updateMarkerPointerEvents();
                } catch (e) {}
              }
            });
          });
        return container;
      }
    });
    const textControl = new TextToggleControl();
    map.addControl(textControl);
    textToggleContainer = textControl.getContainer();

    const ExportControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-export-control');
        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Export Map';
        link.innerHTML = '<i class="fa-solid fa-file-export"></i>';
        exportBtn = link;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'mousedown', L.DomEvent.stopPropagation)
          .on(link, 'dblclick', L.DomEvent.stopPropagation)
          .on(link, 'click', exportMap);
        return container;
      }
    });
    const exportControl = new ExportControl();
    map.addControl(exportControl);
    exportControlContainer = exportControl.getContainer();

    const DrawToggleControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-draw-toggle-control');
        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Draw';
        link.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
        drawBtn = link;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'mousedown', L.DomEvent.stopPropagation)
          .on(link, 'dblclick', L.DomEvent.stopPropagation)
          .on(link, 'click', toggleDrawControl);
        return container;
      }
    });

    // Professional control (placed after Draw control)
    const ProfessionalControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-professional-control');
        container.style.setProperty('margin-top', '1px', 'important');
        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Professional';
        link.innerHTML = '<i class="fa-solid fa-user-lock"></i>';
        professionalBtn = link;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'mousedown', L.DomEvent.stopPropagation)
          .on(link, 'dblclick', L.DomEvent.stopPropagation)
          .on(link, 'click', () => {
            try {
              showProfessionalPrompt();
            } catch (e) {}
          });
        // hide control immediately if overlays already loaded
        if (overlaysLoaded) {
          container.style.display = 'none';
        }
        return container;
      }
    });
    const drawToggle = new DrawToggleControl();
    map.addControl(drawToggle);
    
    // Add professional control right after draw control
    const professionalToggle = new ProfessionalControl();
    map.addControl(professionalToggle);
  }

  function refreshMarkers() {
    if (!map) return;
    markers.forEach(m => m.remove());
    markers = [];
    const list = getFileList();
    const curIdx = getCurrentIndex();

    const groups = {};
    list.forEach((file, idx) => {
      const meta = getFileMetadata(idx);
      const lat = parseFloat(meta.latitude);
      const lon = parseFloat(meta.longitude);
      if (isNaN(lat) || isNaN(lon)) return;
      const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ file, idx, meta, lat, lon });
    });

    function getTimestamp(meta) {
      if (!meta) return '';
      const d = (meta.date || '').replace(/\D/g, '');
      const t = meta.time || '';
      return `${d}${t}`;
    }

    Object.values(groups).forEach(group => {
      group.sort((a, b) => getTimestamp(a.meta).localeCompare(getTimestamp(b.meta)));
      const first = group[0];
      const { lat, lon } = first;
      const isCurrent = group.some(g => g.idx === curIdx);
      const allTrash = group.every(g => getFileIconState(g.idx).trash);
      let cls = 'map-marker-other';
      if (isCurrent) {
        cls = 'map-marker-current';
      } else if (allTrash) {
        cls = 'map-marker-trash';
      }
      const icon = L.divIcon({
        html: '<i class="fa-solid fa-location-dot"></i>',
        className: cls,
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      });
      const fileNames = group.map(g => g.file.name.replace(/\.wav$/i, ''));
      const names = (fileNames.length <= 5)
        ? fileNames.join('<br>')
        : `${fileNames[0]}<br>⋮<br>${fileNames[fileNames.length - 1]}`;
      const zIndexOffset = isCurrent ? 1000 : 0;
      const marker = L.marker([lat, lon], { icon, zIndexOffset });
      marker.on('click', () => {
        document.dispatchEvent(new CustomEvent('map-file-selected', { detail: { index: first.idx } }));
      });
      marker.bindTooltip(names, {
        direction: 'top',
        offset: [-3, -32],
        className: 'map-tooltip'
      });
      marker.addTo(map);
      markers.push(marker);
    });
    updateMarkerPointerEvents();
  }

  function clearRoute() {
    polylines.forEach(l => l.remove());
    polylines = [];
    routeBtn?.classList.remove('active');
    if (routeBtn) {
      routeBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
    }
  }

  function clearKmlRoute() {
    kmlPolylines.forEach(l => l.remove());
    kmlPolylines = [];
  }

  async function importKml(file) {
    if (!file) return;
    const text = await file.text();
    const lines = parseKml(text);
    clearKmlRoute();
    const allCoords = [];
    lines.forEach(coords => {
      const line = L.polyline(coords, {
        color: 'deeppink',
        weight: 2,
        opacity: 0.8,
        renderer: L.canvas()
      }).addTo(map);
      kmlPolylines.push(line);
      allCoords.push(...coords);
    });
    if (allCoords.length > 0) {
      map.fitBounds(allCoords);
      updateMap();
    }
  }

  importKmlFileFn = importKml;

  function parseKml(text) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    const lines = [];
    const lineStrings = doc.getElementsByTagName('LineString');
    for (let i = 0; i < lineStrings.length; i++) {
      const coordsEl = lineStrings[i].getElementsByTagName('coordinates')[0];
      if (!coordsEl) continue;
      const coordsText = coordsEl.textContent.trim();
      const coords = coordsText.split(/\s+/).map(pair => {
        const [lon, lat] = pair.split(',').map(Number);
        return (!isNaN(lat) && !isNaN(lon)) ? [lat, lon] : null;
      }).filter(Boolean);
      if (coords.length > 1) lines.push(coords);
    }
    return lines;
  }

  kmlInput.addEventListener('change', async () => {
    const file = kmlInput.files[0];
    if (file) {
      await importKml(file);
    }
  });

  function drawRoute() {
    if (!map) return;
    clearRoute();
    const list = getFileList();
    const points = [];
    list.forEach((_f, idx) => {
      const meta = getFileMetadata(idx);
      const lat = parseFloat(meta.latitude);
      const lon = parseFloat(meta.longitude);
      const d = (meta.date || '').replace(/\D/g, '');
      const t = meta.time || '';
      const ts = `${d}${t}`;
      if (!isNaN(lat) && !isNaN(lon) && ts) {
        points.push({ lat, lon, ts });
      }
    });
    points.sort((a, b) => a.ts.localeCompare(b.ts));

    let current = [];
    let prev = null;
    points.forEach(p => {
      if (prev) {
        const dist = map.distance([prev.lat, prev.lon], [p.lat, p.lon]);
        if (dist >= 1000) {
          if (current.length > 1) {
            polylines.push(L.polyline(current, {
              color: 'black',
              weight: 2,
              opacity: 0.8,
              renderer: L.canvas()
            }).addTo(map));
          }
          current = [];
        }
      }
      current.push([p.lat, p.lon]);
      prev = p;
    });
    if (current.length > 1) {
      polylines.push(L.polyline(current, {
        color: 'black',
        weight: 2,
        opacity: 0.8,
        renderer: L.canvas()
      }).addTo(map));
    }
  }

  function toggleRoute() {
    if (polylines.length > 0) {
      clearRoute();
    } else {
      drawRoute();
      routeBtn?.classList.add('active');
      if (routeBtn) {
        routeBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
      }
    }
  }

  function toggleDrawControl() {
    if (!drawControl) return;
    const willShow = !drawControlVisible;
    if (willShow && textMode) {
      toggleTextMode();
    }
    if (drawControlVisible) {
      map.removeControl(drawControl);
      drawBtn?.classList.remove('active');
      drawControlVisible = false;
    } else {
      drawControl.addTo(map);
      drawBtn?.classList.add('active');
      drawControlVisible = true;
    }
  }

  function exportMap() {
    if (!map || !window.html2canvas) return;
    const container = map.getContainer();

    const controlContainer = container.querySelector('.leaflet-control-container');
    const controls = [];
    if (controlContainer) {
      controls.push(controlContainer);
    }
    if (coordScaleWrapper) {
      controls.push(coordScaleWrapper);
    }
    controls.forEach(el => { el.style.display = 'none'; });

    html2canvas(container, { useCORS: true }).then(canvas => {
      controls.forEach(el => { el.style.display = ''; });
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'map.png';
      a.click();
    }).catch(() => {
      controls.forEach(el => { el.style.display = ''; });
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    })[c]);
  }

  function createTextIcon(text, showTooltip = false) {
    const titleAttr = showTooltip
      ? ' title="Left click to edit\nRight click to delete"'
      : '';
    return L.divIcon({
      className: 'map-text-icon',
      html: `<span class="map-text-label"${titleAttr}>${escapeHtml(text)}</span>`,
      iconSize: null, // 可保持 null 讓其自適應
      iconAnchor: [0, 0], // 將 anchor 設為左上角
      popupAnchor: [0, 0]
    });
  }

  function editTextMarker(marker) {
    if (!map || activeTextInput) return;
    const latlng = marker.getLatLng();
    const point = map.latLngToContainerPoint(latlng);
  const input = document.createElement('textarea');
  input.value = marker.text || '';
  input.className = 'map-text-input';
  input.rows = 1;
  input.style.left = `${point.x}px`;
  input.style.top = `${point.y}px`;
  map.getContainer().appendChild(input);
  activeTextInput = input;
  map.dragging.disable();
  input.focus();
  const adjustHeight = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  adjustHeight();
  input.addEventListener('input', adjustHeight);
  const finish = () => {
      if (!activeTextInput) return;
      const val = input.value.trim();
      map.getContainer().removeChild(input);
      activeTextInput = null;
      map.dragging.enable();
      if (val) {
        marker.text = val;
        marker.setIcon(createTextIcon(val, textMode));
      } else {
        map.removeLayer(marker);
        textMarkers = textMarkers.filter(m => m !== marker);
      }
      updateMarkerPointerEvents();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish();
      }
    });
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('blur', () => {
      suppressNextTextClick = true;
      setTimeout(() => {
        if (document.activeElement !== input) finish();
      });
    });
  }

  function createTextMarker(latlng, text) {
    const marker = L.marker(latlng, {
      icon: createTextIcon(text, textMode),
      draggable: textMode,
      pane: 'annotationPane',
      zIndexOffset: 1000
    });
    marker.text = text;
    marker.on('dblclick', () => { if (textMode) editTextMarker(marker); });
    marker.on('click', (e) => {
      if (textMode && !activeTextInput) {
        e.originalEvent.stopPropagation();
        editTextMarker(marker);
      }
    });
    marker.on('contextmenu', (evt) => {
      // 使用 dropdown.js 顯示一個只有 "Remove" 的選單，按下後再刪除文字標記
      if (!(textMode && !activeTextInput)) return;
      try {
        const orig = evt.originalEvent || evt.srcEvent || {};
        orig.preventDefault?.();
        orig.stopPropagation?.();
      } catch (e) {}

      // 建立一個臨時按鈕，Dropdown 會根據按鈕位置來定位選單
      const btn = document.createElement('button');
      btn.style.position = 'absolute';
      btn.style.left = (evt.originalEvent?.clientX || 0) + 'px';
      btn.style.top = (evt.originalEvent?.clientY || 0) + 'px';
      btn.style.width = '1px';
      btn.style.height = '1px';
      btn.style.padding = '0';
      btn.style.margin = '0';
      btn.style.opacity = '0';
      btn.style.zIndex = '2147483647';
      btn.style.pointerEvents = 'auto';
      document.body.appendChild(btn);

      const items = [{ label: 'Remove', value: 'remove' }];
      const dropdown = new Dropdown(btn, items, {
        onChange: (val) => {
          try {
            if (val && (val.value === 'remove' || val.label === 'Remove')) {
              map.removeLayer(marker);
              textMarkers = textMarkers.filter(m => m !== marker);
              updateMarkerPointerEvents();
            }
          } finally {
            cleanup();
          }
        }
      });

      // 將選項文字顯示為紅色以表危險操作
      try {
        const first = dropdown.menu.querySelector('.dropdown-item');
        if (first) first.style.color = 'red';
      } catch (e) {}

      // 當選單關閉時做清理（移除臨時按鈕與選單 DOM）
      const cleanup = () => {
        try {
          if (dropdown && typeof dropdown.close === 'function') dropdown.close();
        } catch (e) {}
        try {
          if (dropdown && dropdown.menu && dropdown.menu.parentNode) dropdown.menu.parentNode.removeChild(dropdown.menu);
        } catch (e) {}
        try { if (btn && btn.parentNode) btn.parentNode.removeChild(btn); } catch (e) {}
      };

      // 包裝 close 以確保一旦關閉就清理
      try {
        const origClose = dropdown.close.bind(dropdown);
        dropdown.close = function() {
          origClose();
          cleanup();
        };
      } catch (e) {}

      dropdown.open();
    });
    return marker;
  }

  function updateTextMarkersDraggable() {
    textMarkers.forEach(m => {
      if (textMode) m.dragging.enable();
      else m.dragging.disable();
      const txt = m.text || '';
      m.setIcon(createTextIcon(txt, textMode));
      m.setZIndexOffset(1000);
    });
    updateMarkerPointerEvents();
  }

  function onMapTextClick(e) {
    if (suppressNextTextClick) {
      suppressNextTextClick = false;
      return;
    }
    if (activeTextInput) return;
    const marker = createTextMarker(e.latlng, '');
    marker.addTo(map);
    textMarkers.push(marker);
    updateMarkerPointerEvents();
    editTextMarker(marker);
  }

  function toggleTextMode() {
    const newMode = !textMode;
    if (newMode && drawControlVisible) {
      toggleDrawControl();
    }
    textMode = newMode;
    textBtn?.classList.toggle('active', textMode);
    if (textMode) {
      map.on('click', onMapTextClick);
    } else {
      map.off('click', onMapTextClick);
      if (activeTextInput) {
        activeTextInput.blur();
      }
    }
    updateTextMarkersDraggable();
    updateCursor();
  }

  function showDeviceLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const icon = L.divIcon({
        html: '<i class="fa-solid fa-location-arrow"></i>',
        className: 'map-marker-device',
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      });
      if (!map) {
        createMap(lat, lon);
      } else {
        map.setView([lat, lon]);
      }
      const marker = L.marker([lat, lon], { icon, zIndexOffset: 1001 });
      marker.addTo(map);
      markers.push(marker);
      updateMarkerPointerEvents();
    });
  }

  const DEFAULT_ZOOM = 13;

  function updateMap() {
    const idx = getCurrentIndex();
    if (idx < 0) {
      refreshMarkers();
      hideNoCoordMessage();
      const list = getFileList();
      const HK_BOUNDS = [[21.8, 113.8], [22.7, 114.5]]; // [southWestLat, southWestLng], [northEastLat, northEastLng]
      const HK_CENTER = [22.28552, 114.15769]; // approximate center of Hong Kong

      if (!map) {
        createMap(HK_CENTER[0], HK_CENTER[1]);
      }

      if (!list || list.length === 0) {
        try {
          map.fitBounds(HK_BOUNDS);
        } catch (e) {
          map.setView(HK_CENTER, DEFAULT_ZOOM);
        }
      }

      showDeviceLocation();	  
      return;
    }
    const meta = getFileMetadata(idx);
    const lat = parseFloat(meta.latitude);
    const lon = parseFloat(meta.longitude);
    if (isNaN(lat) || isNaN(lon)) {
      refreshMarkers();
      showNoCoordMessage();
      return;
    }
    hideNoCoordMessage();

    if (!map) {
      createMap(lat, lon);
    } else {
      if (popup.style.display !== 'block') {
        map.setView([lat, lon], DEFAULT_ZOOM);
      } else {
        map.setView([lat, lon]);
      }
    }
    refreshMarkers();
  }

  function togglePopup() {
    if (popup.style.display === 'block') {
      if (isMaximized) toggleMaximize();
      if (isMinimized) toggleMinimize();
      popup.style.display = 'none';
      document.body.classList.remove('map-open');
      if (textMode) toggleTextMode();
    } else {
      popup.style.display = 'block';
      document.body.classList.add('map-open');
      popup.style.width = `${popupWidth}px`;
      popup.style.height = `${popupHeight}px`;
      if (map) {
        map.invalidateSize();
      }
      updateMap();
      updateCursor();
      // prompt if overlays are pending (handles case where fetch completed earlier or later)
      promptForPasswordIfNeeded();
    }
  }

  function toggleMaximize() {
    if (!isMaximized) {
      // 如果是從最小化狀態直接最大化，只需要還原顯示元素
      if (isMinimized) {
        if (layersControlContainer) layersControlContainer.style.display = '';
        if (zoomControlContainer) zoomControlContainer.style.display = '';
        if (routeToggleContainer) routeToggleContainer.style.display = '';
        if (exportControlContainer) exportControlContainer.style.display = '';
        if (coordScaleWrapper) coordScaleWrapper.style.display = '';
        if (textToggleContainer) textToggleContainer.style.setProperty('margin-top', '1px', 'important');
        isMinimized = false;
      } else {
        // 只有在從浮動狀態切換到最大化時，才儲存當前狀態
        floatingState.width = popup.offsetWidth;
        floatingState.height = popup.offsetHeight;
        floatingState.left = popup.offsetLeft;
        floatingState.top = popup.offsetTop;
        localStorage.setItem('mapFloatingWidth', floatingState.width);
        localStorage.setItem('mapFloatingHeight', floatingState.height);
        localStorage.setItem('mapFloatingLeft', floatingState.left);
        localStorage.setItem('mapFloatingTop', floatingState.top);
      }
      // 設置最大化狀態
      popup.style.left = '0px';
      popup.style.top = '0px';
      popup.style.width = `${window.innerWidth -2}px`;
      popup.style.height = `${window.innerHeight -2}px`;
      // 狀態：最大化
      minBtn.innerHTML = '<i class="fa-solid fa-window-minimize"></i>';
      minBtn.title = 'Minimize';
      maxBtn.innerHTML = '<i class="fa-regular fa-clone"></i>';
      maxBtn.title = 'Restore Down';
      isMaximized = true;
    } else {
      // 從最大化狀態還原時，直接使用儲存的浮動視窗狀態
      popup.style.width = `${floatingState.width}px`;
      popup.style.height = `${floatingState.height}px`;
      popup.style.left = `${floatingState.left}px`;
      popup.style.top = `${floatingState.top}px`;
      // 狀態：一般（非最大化/最小化）
      minBtn.innerHTML = '<i class="fa-solid fa-window-minimize"></i>';
      minBtn.title = 'Minimize';
      maxBtn.innerHTML = '<i class="fa-regular fa-square"></i>';
      maxBtn.title = 'Maximize';
      isMaximized = false;
    }
    map?.invalidateSize();
  }

  function toggleMinimize() {
    if (!isMinimized) {
      // 如果是從浮動狀態最小化，儲存當前狀態
      if (!isMaximized) {
        floatingState.width = popup.offsetWidth;
        floatingState.height = popup.offsetHeight;
        floatingState.left = popup.offsetLeft;
        floatingState.top = popup.offsetTop;
        localStorage.setItem('mapFloatingWidth', floatingState.width);
        localStorage.setItem('mapFloatingHeight', floatingState.height);
        localStorage.setItem('mapFloatingLeft', floatingState.left);
        localStorage.setItem('mapFloatingTop', floatingState.top);
      }
      // 設置最小化狀態（從任何狀態都直接最小化）
      popup.style.left = '0px';
      popup.style.top = `${window.innerHeight - 362}px`;
      popup.style.width = '290px';
      popup.style.height = '360px';
      // 狀態：最小化
      minBtn.innerHTML = '<i class="fa-solid fa-window-maximize"></i>';
      minBtn.title = 'Restore Up';
      maxBtn.innerHTML = '<i class="fa-regular fa-square"></i>';
      maxBtn.title = 'Maximize';
      if (layersControlContainer) layersControlContainer.style.display = 'none';
      if (zoomControlContainer) zoomControlContainer.style.display = 'none';
      if (routeToggleContainer) routeToggleContainer.style.display = 'none';
      if (exportControlContainer) exportControlContainer.style.display = 'none';
      if (coordScaleWrapper) coordScaleWrapper.style.display = 'none';
      if (textToggleContainer) textToggleContainer.style.setProperty('margin-top', '10px', 'important');
      // Hide professional button in minimized state
      if (professionalBtn?.parentElement) {
        professionalBtn.parentElement.style.display = 'none';
      }
      isMinimized = true;
      isMaximized = false; // 確保狀態正確
    } else {
      // 從最小化狀態還原，直接使用儲存的浮動視窗狀態
      popup.style.width = `${floatingState.width}px`;
      popup.style.height = `${floatingState.height}px`;
      popup.style.left = `${floatingState.left}px`;
      popup.style.top = `${floatingState.top}px`;
      // 狀態：一般（非最大化/最小化）
      minBtn.innerHTML = '<i class="fa-solid fa-window-minimize"></i>';
      minBtn.title = 'Minimize';
      maxBtn.innerHTML = '<i class="fa-regular fa-square"></i>';
      maxBtn.title = 'Maximize';
      if (layersControlContainer) layersControlContainer.style.display = '';
      if (zoomControlContainer) zoomControlContainer.style.display = '';
      if (routeToggleContainer) routeToggleContainer.style.display = '';
      if (exportControlContainer) exportControlContainer.style.display = '';
      if (coordScaleWrapper) coordScaleWrapper.style.display = '';
      if (textToggleContainer) textToggleContainer.style.setProperty('margin-top', '1px', 'important');
      // Show professional button only if overlays are not loaded yet
      if (professionalBtn?.parentElement && !overlaysLoaded) {
        professionalBtn.parentElement.style.display = '';
      }
      isMinimized = false;
    }
    map?.invalidateSize();
  }

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  let resizing = false;
  let resizeLeft = false;
  let resizeRight = false;
  let resizeTop = false;
  let resizeBottom = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let startLeft = 0;
  let startTop = 0;
  let isMaximized = false;
  let isMinimized = false;
  
  // 儲存 Floating window 的最後狀態
  // compute center defaults based on current popup size
  const centerLeftDefault = Math.max(0, Math.floor((window.innerWidth - popupWidth) / 2));
  const centerTopDefault = Math.max(0, Math.floor((window.innerHeight - popupHeight) / 2));
  let floatingState = {
    width: parseInt(localStorage.getItem('mapFloatingWidth'), 10) || popupWidth,
    height: parseInt(localStorage.getItem('mapFloatingHeight'), 10) || popupHeight,
    left: parseInt(localStorage.getItem('mapFloatingLeft'), 10) || centerLeftDefault,
    top: parseInt(localStorage.getItem('mapFloatingTop'), 10) || centerTopDefault
  };

  // ensure popup initially positioned at center (or stored position)
  try {
    popup.style.left = `${floatingState.left}px`;
    popup.style.top = `${floatingState.top}px`;
  } catch (e) {
    // ignore if popup not in DOM or styles cannot be set yet
  }

  function disableUiPointerEvents() {
    if (viewer) {
      viewer.style.pointerEvents = 'none';
      viewer.classList.remove('hide-cursor');
    }
    if (controlBar) controlBar.style.pointerEvents = 'none';
    if (sidebar) sidebar.style.pointerEvents = 'none';
  }

  function enableUiPointerEvents() {
    if (viewer) viewer.style.pointerEvents = '';
    if (controlBar) controlBar.style.pointerEvents = '';
    if (sidebar) sidebar.style.pointerEvents = '';
  }

  if (dragBar) {
    dragBar.addEventListener('mousedown', (e) => {
      if (isMaximized) return;
      dragging = true;
      offsetX = e.clientX - popup.offsetLeft;
      offsetY = e.clientY - popup.offsetTop;
      map?.dragging.disable();
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      e.preventDefault();
      e.stopPropagation();
    });
  }

  popup.addEventListener('mousemove', (e) => {
    if (isMaximized) return;
    if (dragging || resizing) {
      e.stopPropagation();
      return;
    }
    const state = getEdgeState(e.clientX, e.clientY);
    const cursor = edgeCursor(state) || 'default';
    popup.style.cursor = cursor;
    if (cursor !== 'default') {
      mapDiv.style.cursor = cursor;
      document.body.style.cursor = cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      e.stopPropagation();
    } else {
      mapDiv.style.cursor = '';
      document.body.style.cursor = '';
      enableUiPointerEvents();
      updateCursor();
    }
  });

  popup.addEventListener('mousedown', (e) => {
    if (isMaximized) return;
    if (e.target === dragBar || dragBar.contains(e.target)) return;
    const state = getEdgeState(e.clientX, e.clientY);
    if (state.onLeft || state.onRight || state.onTop || state.onBottom) {
      resizing = true;
      resizeLeft = state.onLeft;
      resizeRight = state.onRight;
      resizeTop = state.onTop;
      resizeBottom = state.onBottom;
      const cursor = edgeCursor(state) || 'default';
      popup.style.cursor = cursor;
      mapDiv.style.cursor = cursor;
      document.body.style.cursor = cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      startX = e.clientX;
      startY = e.clientY;
      startWidth = popup.offsetWidth;
      startHeight = popup.offsetHeight;
      startLeft = popup.offsetLeft;
      startTop = popup.offsetTop;
      map?.dragging.disable();
      e.preventDefault();
      e.stopPropagation();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (popup.style.display !== 'block' || isMaximized) return;
    if (dragging || resizing) {
      e.stopPropagation();
      return;
    }
    const state = getEdgeState(e.clientX, e.clientY);
    const cursor = edgeCursor(state);
    if (cursor) {
      document.body.style.cursor = cursor;
      mapDiv.style.cursor = cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      e.stopPropagation();
    } else {
      document.body.style.cursor = '';
      mapDiv.style.cursor = '';
      enableUiPointerEvents();
      updateCursor();
    }
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (popup.style.display !== 'block' || isMaximized) return;
    if (dragging || resizing) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (e.target === dragBar || dragBar.contains(e.target)) return;
    const state = getEdgeState(e.clientX, e.clientY);
    if (state.onLeft || state.onRight || state.onTop || state.onBottom) {
      resizing = true;
      resizeLeft = state.onLeft;
      resizeRight = state.onRight;
      resizeTop = state.onTop;
      resizeBottom = state.onBottom;
      const cursor = edgeCursor(state) || 'default';
      popup.style.cursor = cursor;
      mapDiv.style.cursor = cursor;
      document.body.style.cursor = cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      startX = e.clientX;
      startY = e.clientY;
      startWidth = popup.offsetWidth;
      startHeight = popup.offsetHeight;
      startLeft = popup.offsetLeft;
      startTop = popup.offsetTop;
      map?.dragging.disable();
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  window.addEventListener('mousemove', (e) => {
    if (isMaximized) return;
    if (dragging) {
      // 限制 popup 不超出視窗範圍
      const popupWidth = popup.offsetWidth;
      const popupHeight = popup.offsetHeight;
      let newLeft = e.clientX - offsetX;
      let newTop = e.clientY - offsetY;
      // 限制 left/top 不小於 0
      newLeft = Math.max(0, newLeft);
      newTop = Math.max(0, newTop);
      // 限制 right/bottom 不大於 window 大小
      newLeft = Math.min(window.innerWidth - popupWidth, newLeft);
      newTop = Math.min(window.innerHeight - popupHeight, newTop);
      popup.style.left = `${newLeft}px`;
      popup.style.top = `${newTop}px`;
      e.stopPropagation();
      return;
    }
    if (resizing) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      mapDiv.style.cursor = popup.style.cursor;
      document.body.style.cursor = popup.style.cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      if (resizeRight) {
        popupWidth = Math.max(200, startWidth + dx);
        popup.style.width = `${popupWidth}px`;
      }
      if (resizeBottom) {
        popupHeight = Math.max(200, startHeight + dy);
        popup.style.height = `${popupHeight}px`;
      }
      if (resizeLeft) {
        popupWidth = Math.max(200, startWidth - dx);
        popup.style.width = `${popupWidth}px`;
        popup.style.left = `${startLeft + dx}px`;
      }
      if (resizeTop) {
        popupHeight = Math.max(200, startHeight - dy);
        popup.style.height = `${popupHeight}px`;
        popup.style.top = `${startTop + dy}px`;
      }
      e.stopPropagation();
    }
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (isMaximized) return;
    if (dragging) {
      dragging = false;
      map?.dragging.enable();
      enableUiPointerEvents();
      e.stopPropagation();
    }
    if (resizing) {
      resizing = false;
      map?.dragging.enable();
      
      // 只在非最小化和非最大化狀態時更新並儲存 Floating window 狀態
      if (!isMinimized && !isMaximized) {
        floatingState.width = popup.offsetWidth;
        floatingState.height = popup.offsetHeight;
        floatingState.left = popup.offsetLeft;
        floatingState.top = popup.offsetTop;
        
        localStorage.setItem('mapFloatingWidth', floatingState.width);
        localStorage.setItem('mapFloatingHeight', floatingState.height);
        localStorage.setItem('mapFloatingLeft', floatingState.left);
        localStorage.setItem('mapFloatingTop', floatingState.top);
      }
      
      map?.invalidateSize();
      document.body.style.cursor = '';
      popup.style.cursor = '';
      mapDiv.style.cursor = '';
      enableUiPointerEvents();
      updateCursor();
      e.stopPropagation();
    }
  }, true);

  btn.addEventListener('click', togglePopup);
  maxBtn?.addEventListener('click', toggleMaximize);
  minBtn?.addEventListener('click', toggleMinimize);
  if (closeBtn) {
    closeBtn.addEventListener('click', togglePopup);
  }
  window.addEventListener('resize', () => {
    if (isMaximized) {
      popup.style.width = `${window.innerWidth -2}px`;
      popup.style.height = `${window.innerHeight -2}px`;
      map?.invalidateSize();
    } else if (isMinimized) {
      popup.style.top = `${window.innerHeight - 362}px`;
    }
  });
  document.addEventListener('file-loaded', updateMap);
  document.addEventListener('file-list-cleared', () => refreshMarkers());
  document.addEventListener('file-list-changed', () => refreshMarkers());
  document.addEventListener('file-icon-toggled', () => refreshMarkers());
}

export async function importKmlFile(file) {
  if (importKmlFileFn && file) {
    await importKmlFileFn(file);
  }
}
