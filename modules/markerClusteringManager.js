/**
 * 主線程聚類協調器
 * 負責：
 * 1. 管理 Worker 通信
 * 2. 根據地圖事件觸發聚類更新
 * 3. 渲染 cluster markers 與 individual markers
 * 4. 動畫過渡
 */

export class MarkerClusteringManager {
  constructor(map, options = {}) {
    this.map = map;
    this.worker = null;
    this.isWorkerReady = false;

    // 配置
    this.maxVisibleMarkers = options.maxVisibleMarkers || 500;
    this.enableAnimation = options.enableAnimation !== false;
    this.animationDuration = options.animationDuration || 300; // ms

    // 狀態
    this.allSurveyPoints = [];
    this.currentClusters = [];
    this.currentVisibleMarkers = [];
    this.clusterMarkersMap = new Map(); // id -> L.marker
    this.visibleMarkersMap = new Map(); // id -> L.marker
    this.clusterLayerGroup = null;
    this.markerLayerGroup = null;
    this.computationInFlight = false;
    this.pendingComputeRequest = null;
    this.isClustered = true; // 是否使用聚類模式
    this.wasClusteredBefore = true; // 上次是否使用聚類（用於過渡動畫）

    // 事件節流
    this.zoomThrottleTimer = null;
    this.zoomThrottleDelay = 200; // ms

    // 儲存 pinned point IDs（不是 marker 引用，因為 markers 會重新建立）
    this.pinnedPointIds = new Set();

    // 錯誤追蹤
    this.errorCount = 0;
    this.maxErrorCount = 5;

    this.init();
  }

  init() {
    // 初始化 Web Worker
    try {
      // 嘗試使用標準 Worker 初始化
      this.worker = new Worker(new URL('./clusterWorker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event) => this.handleWorkerMessage(event);
      this.worker.onerror = (error) => {
        console.error('[ClusterManager] Worker error:', error);
        this.onWorkerError();
      };
      this.isWorkerReady = true;
      console.log('[ClusterManager] Worker initialized');
    } catch (e) {
      console.warn('[ClusterManager] Worker not supported, degrading to main thread:', e);
      this.isWorkerReady = false;
    }

    // 建立圖層
    this.clusterLayerGroup = L.layerGroup();
    this.markerLayerGroup = L.layerGroup();
    // Note: Layers will be added to map through overlay control, not here

    // 監聽地圖事件
    this.map.on('zoomstart', () => this.onZoomOrMoveStart());
    this.map.on('zoomend', () => this.onZoomOrMoveEnd());
    this.map.on('moveend', () => this.onZoomOrMoveEnd());

    console.log('[ClusterManager] Initialized');
  }

  /**
   * 設置所有 survey points 數據
   */
  setSurveyPoints(points) {
    this.allSurveyPoints = points;
    console.log(`[ClusterManager] Received ${points.length} survey points`);

    if (this.isWorkerReady && this.worker) {
      try {
        this.worker.postMessage({
          type: 'INIT',
          payload: { points: this.serializePoints(points) },
        });
      } catch (e) {
        console.error('[ClusterManager] Error sending INIT to Worker:', e);
        this.onWorkerError();
      }
    }

    // 立即觸發聚類計算
    this.scheduleComputation();
  }

  /**
   * 將 Leaflet marker 點資料序列化以傳送至 Worker
   */
  serializePoints(points) {
    return points.map((p, idx) => {
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      
      if (!isFinite(lat) || !isFinite(lng)) {
        console.warn('[ClusterManager] Invalid point at index', idx, ':', p);
      }
      
      return {
        id: p.id || `survey_${idx}`,
        lat: lat,
        lng: lng,
        meta: { location: p.location || 'Survey Point' },
      };
    });
  }

  /**
   * 節流 zoom/move 事件
   */
  onZoomOrMoveStart() {
    // zoom/move 開始時可清除待機任務
    if (this.zoomThrottleTimer) {
      clearTimeout(this.zoomThrottleTimer);
      this.zoomThrottleTimer = null;
    }
  }

  onZoomOrMoveEnd() {
    this.scheduleComputation();
  }

  /**
   * 排程聚類計算（節流版本）
   */
  scheduleComputation() {
    if (this.zoomThrottleTimer) {
      clearTimeout(this.zoomThrottleTimer);
    }

    this.zoomThrottleTimer = setTimeout(() => {
      this.zoomThrottleTimer = null;
      this.computeClusters();
    }, this.zoomThrottleDelay);
  }

  /**
   * 觸發 Worker 聚類計算
   */
  computeClusters() {
    if (!this.map || this.allSurveyPoints.length === 0) return;

    const zoom = this.map.getZoom();
    const bounds = this.map.getBounds();

    const mapBounds = {
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast(),
    };

    if (this.isWorkerReady && this.worker && !this.computationInFlight) {
      try {
        this.computationInFlight = true;
        this.worker.postMessage({
          type: 'COMPUTE_CLUSTERS',
          payload: { zoom, bounds: mapBounds },
        });
      } catch (e) {
        console.error('[ClusterManager] Error sending COMPUTE_CLUSTERS to Worker:', e);
        this.computationInFlight = false;
        this.onWorkerError();
      }
    }
  }

  /**
   * Worker 錯誤處理
   */
  onWorkerError() {
    this.errorCount++;
    if (this.errorCount >= this.maxErrorCount) {
      console.error('[ClusterManager] Max error count reached, disabling Worker');
      this.isWorkerReady = false;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
    }
  }

  /**
   * 處理來自 Worker 的消息
   */
  handleWorkerMessage(event) {
    const { type, result, message, stack } = event.data;

    if (type === 'ERROR') {
      console.error('[ClusterManager] Worker error:', message, stack);
      this.computationInFlight = false;
      this.onWorkerError();
      return;
    }

    if (type === 'INIT_DONE') {
      console.log('[ClusterManager] Worker initialization complete');
      return;
    }

    if (type === 'CLUSTERS_COMPUTED') {
      this.errorCount = 0; // 成功時重置錯誤計數
      this.computationInFlight = false;
      this.currentClusters = result.clusters;
      this.currentVisibleMarkers = result.visiblePoints;
      this.isClustered = result.isClustered !== false; // 更新聚類模式狀態
      
      console.log(
        `[ClusterManager] Computed: ${result.clusters.length} clusters, ${result.visiblePoints.length} visible markers (clustered: ${this.isClustered})`
      );
      
      this.renderClusters();
    }
  }

  /**
   * 渲染 clusters 和 visible markers
   * 支援聚類模式和非聚類模式的平滑過渡
   */
  renderClusters() {
    try {
      const modeChanged = this.wasClusteredBefore !== this.isClustered;
      
      // 淡出舊 markers（可選動畫）
      if (this.enableAnimation) {
        this.fadeOutMarkers();
      }

      // 稍後清除並添加新 markers
      const fadeOutDuration = this.enableAnimation ? 150 : 0;
      setTimeout(() => {
        this.clusterLayerGroup.clearLayers();
        this.markerLayerGroup.clearLayers();
        this.clusterMarkersMap.clear();
        this.visibleMarkersMap.clear();

        // 如果從聚類切換到非聚類（或反之），顯示過渡訊息
        if (modeChanged) {
          console.log(
            `[ClusterManager] Mode transition: ${this.wasClusteredBefore ? 'Clustered' : 'Unclustered'} → ${this.isClustered ? 'Clustered' : 'Unclustered'}`
          );
        }

        if (this.isClustered) {
          // 聚類模式：渲染 cluster markers 和個別 markers
          for (let cluster of this.currentClusters) {
            try {
              const clusterMarker = this.createClusterMarker(cluster);
              this.clusterLayerGroup.addLayer(clusterMarker);
              this.clusterMarkersMap.set(cluster.id, clusterMarker);
            } catch (e) {
              console.error('[ClusterManager] Error creating cluster marker:', e);
            }
          }

          for (let point of this.currentVisibleMarkers) {
            try {
              const marker = this.createIndividualMarker(point);
              this.markerLayerGroup.addLayer(marker);
              this.visibleMarkersMap.set(point.id, marker);
              
              // 如果這個 point 之前被 pinned，重新應用 pin 狀態
              if (this.pinnedPointIds.has(point.id)) {
                this.toggleMarkerPin(marker, point, true);
              }
            } catch (e) {
              console.error('[ClusterManager] Error creating individual marker:', e);
            }
          }
        } else {
          // 非聚類模式：渲染所有 markers 為個別 markers
          for (let point of this.currentVisibleMarkers) {
            try {
              const marker = this.createIndividualMarker(point);
              this.markerLayerGroup.addLayer(marker);
              this.visibleMarkersMap.set(point.id, marker);
              
              // 如果這個 point 之前被 pinned，重新應用 pin 狀態
              if (this.pinnedPointIds.has(point.id)) {
                this.toggleMarkerPin(marker, point, true);
              }
            } catch (e) {
              console.error('[ClusterManager] Error creating individual marker:', e);
            }
          }
        }

        // 淡入新 markers（可選動畫）
        if (this.enableAnimation) {
          this.fadeInMarkers();
        }
        
        // 更新過渡狀態
        this.wasClusteredBefore = this.isClustered;
        
        // 如果有 surveyPointLayer，更新其內容（用於 overlay 動態顯示）
        if (this.updateSurveyPointLayers) {
          this.updateSurveyPointLayers();
        }
      }, fadeOutDuration);
    } catch (e) {
      console.error('[ClusterManager] Error during render:', e);
    }
  }

  /**
   * 淡出所有 markers
   */
  fadeOutMarkers() {
    const allMarkers = [...this.clusterMarkersMap.values(), ...this.visibleMarkersMap.values()];
    for (let marker of allMarkers) {
      const el = marker.getElement();
      if (el) {
        el.style.opacity = '0.3';
        el.style.transition = `opacity 150ms ease-out`;
      }
    }
  }

  /**
   * 淡入所有 markers
   */
  fadeInMarkers() {
    const allMarkers = [...this.clusterMarkersMap.values(), ...this.visibleMarkersMap.values()];
    for (let marker of allMarkers) {
      const el = marker.getElement();
      if (el) {
        el.style.transition = `opacity ${this.animationDuration}ms ease-in`;
        el.style.opacity = '1';
      }
    }
  }

  /**
   * 建立聚類 marker
   */
  createClusterMarker(cluster) {
    const marker = L.marker([cluster.lat, cluster.lng], {
      icon: L.divIcon({
        html: `<div class="cluster-marker-icon" data-cluster-count="${cluster.count}" title="${cluster.count} markers" style="pointer-events: auto;">
          ${cluster.count}
        </div>`,
        className: 'cluster-marker-container',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20],
      }),
    });

    // 聚類 marker 的 tooltip
    marker.bindTooltip(`${cluster.count} survey sites in this area`, {
      direction: 'top',
      offset: [0, -20],
      className: 'cluster-tooltip',
      permanent: false,
    });

    // 在 marker 創建完成後添加事件監聽
    const setupMarkerEvents = () => {
      const el = marker.getElement();
      if (el) {
        const iconDiv = el.querySelector('.cluster-marker-icon');
        if (iconDiv) {
          // Hover 事件
          iconDiv.addEventListener('mouseenter', () => {
            iconDiv.classList.add('cluster-marker-hover');
          });
          iconDiv.addEventListener('mouseleave', () => {
            iconDiv.classList.remove('cluster-marker-hover');
          });
        }
      }
    };

    // 在 DOM 渲染後執行
    setTimeout(setupMarkerEvents, 0);

    return marker;
  }

  /**
   * 建立個別 marker
   */
  createIndividualMarker(point) {
    const marker = L.marker([point.lat, point.lng], {
      icon: L.divIcon({
        html: '<i class="fa-solid fa-location-dot" style="color:#000000; text-shadow: 0 0 2px #fff, 0 0 6px #fff;"></i>',
        className: 'map-marker-survey',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
    });

    // 默認 tooltip
    marker.bindTooltip(point.meta?.location || 'Survey Point', {
      direction: 'top',
      offset: [-6, -22],
      className: 'map-tooltip',
      permanent: false,
    });

    // 點擊切換 pin 狀態
    marker.on('click', (evt) => {
      try {
        evt.originalEvent?.stopPropagation();
      } catch (e) {}
      this.toggleMarkerPin(marker, point);
    });

    // 標記內部屬性
    marker._surveyPointData = point;
    marker._tooltipPinned = false;
    marker._pinnedIsPopup = false;

    return marker;
  }

  /**
   * 切換 marker 的 pin 狀態
   */
  toggleMarkerPin(marker, point, delayOpen = false) {
    if (!marker._tooltipPinned) {
      // Pin: 切換到 popup
      try {
        marker.unbindTooltip();
      } catch (e) {}
      try {
        marker.unbindPopup();
      } catch (e) {}

      marker.bindPopup(point.meta?.location || 'Survey Point', {
        className: 'map-tooltip map-tooltip-pinned',
        closeButton: false,
        autoClose: false,
        closeOnClick: false,
        autoPan: false,
        offset: L.point(-6, -8),
      });
      
      marker._tooltipPinned = true;
      marker._pinnedIsPopup = true;
      this.pinnedPointIds.add(point.id);
      
      // 如果 delayOpen 為 true，延遲打開 popup（用於重建時的恢復）
      if (delayOpen) {
        setTimeout(() => {
          try { if (marker._tooltipPinned) marker.openPopup(); } catch (err) {}
        }, 50);
      } else {
        marker.openPopup();
      }
    } else {
      // Unpin: 切換回 tooltip
      try {
        marker.closePopup();
      } catch (e) {}
      try {
        marker.unbindPopup();
      } catch (e) {}

      marker.bindTooltip(point.meta?.location || 'Survey Point', {
        direction: 'top',
        offset: [-6, -22],
        className: 'map-tooltip',
        permanent: false,
      });
      marker._tooltipPinned = false;
      marker._pinnedIsPopup = false;
      this.pinnedPointIds.delete(point.id);
    }
  }

  /**
   * 計算聚類的邊界框
   */
  getBboxForCluster(cluster) {
    if (!cluster) {
      console.warn('[ClusterManager] Cluster is null/undefined');
      return null;
    }

    if (!cluster.points || !Array.isArray(cluster.points)) {
      console.warn('[ClusterManager] Cluster.points is not an array:', cluster);
      return null;
    }

    if (cluster.points.length === 0) {
      console.warn('[ClusterManager] Cluster has no points');
      return null;
    }

    // 調試：打印前幾個點的結構
    console.log('[ClusterManager] First point in cluster:', cluster.points[0]);

    const validPoints = cluster.points.filter(p => {
      if (!p) return false;
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      const isValid = !isNaN(lat) && !isNaN(lng) && isFinite(lat) && isFinite(lng);
      if (!isValid) {
        console.warn('[ClusterManager] Invalid point:', p, '-> lat:', lat, 'lng:', lng);
      }
      return isValid;
    });

    if (validPoints.length === 0) {
      console.warn('[ClusterManager] No valid points in cluster:', cluster.points);
      return null;
    }

    const lats = validPoints.map(p => Number(p.lat));
    const lngs = validPoints.map(p => Number(p.lng));
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    // 驗證邊界值
    if (!isFinite(minLat) || !isFinite(maxLat) || !isFinite(minLng) || !isFinite(maxLng)) {
      console.warn('[ClusterManager] Invalid bounds calculated:', { minLat, maxLat, minLng, maxLng });
      return null;
    }

    console.log('[ClusterManager] Valid bbox for cluster:', { minLat, maxLat, minLng, maxLng });
    return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
  }

  /**
   * 更新數據（檔案列表變化時調用）
   */
  updateData(points) {
    this.setSurveyPoints(points);
  }

  /**
   * 取得 cluster layer group
   */
  getClusterLayerGroup() {
    return this.clusterLayerGroup;
  }

  /**
   * 取得 marker layer group
   */
  getMarkerLayerGroup() {
    return this.markerLayerGroup;
  }

  /**
   * 取得所有當前 pinned 的 marker 對象
   * 用於 mapPopup.js 同步 pinnedSurveyMarkers
   */
  getPinnedMarkers() {
    const pinnedMarkers = new Set();
    for (let pointId of this.pinnedPointIds) {
      const marker = this.visibleMarkersMap.get(pointId);
      if (marker) {
        pinnedMarkers.add(marker);
      }
    }
    return pinnedMarkers;
  }

  /**
   * 銷毀 manager（清理資源）
   */
  destroy() {
    if (this.zoomThrottleTimer) {
      clearTimeout(this.zoomThrottleTimer);
    }
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch (e) {
        console.warn('[ClusterManager] Error terminating worker:', e);
      }
    }
    if (this.clusterLayerGroup) {
      this.map.removeLayer(this.clusterLayerGroup);
    }
    if (this.markerLayerGroup) {
      this.map.removeLayer(this.markerLayerGroup);
    }
    this.clusterMarkersMap.clear();
    this.visibleMarkersMap.clear();
    this.pinnedPointIds.clear();
    console.log('[ClusterManager] Destroyed');
  }
}

export default MarkerClusteringManager;
