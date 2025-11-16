/**
 * Clustering Web Worker
 * 在背景線程中執行 CPU 密集的聚類計算
 */

import { ClusterEngine } from './markerClusterer.js';

let clusterEngine = null;
let currentZoom = 13;
let currentBounds = null;

/**
 * Worker 初始化：接收所有 survey points 數據
 */
self.onmessage = async (event) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'INIT': {
        // payload = { points: [...] }
        clusterEngine = new ClusterEngine(payload.points);
        self.postMessage({ type: 'INIT_DONE', success: true });
        break;
      }

      case 'UPDATE_POINTS': {
        // payload = { points: [...] }
        if (clusterEngine) {
          clusterEngine.updatePoints(payload.points);
        }
        self.postMessage({ type: 'UPDATE_POINTS_DONE', success: true });
        break;
      }

      case 'COMPUTE_CLUSTERS': {
        // payload = { zoom: 13, bounds: { minLat, maxLat, minLng, maxLng } }
        if (!clusterEngine) {
          self.postMessage({ type: 'ERROR', message: 'ClusterEngine not initialized' });
          break;
        }

        currentZoom = payload.zoom;
        currentBounds = payload.bounds;

        const result = clusterEngine.computeClusters(payload.zoom, payload.bounds);

        // 回傳結果（clusters、visiblePoints 與是否採用聚類模式）
        self.postMessage({
          type: 'CLUSTERS_COMPUTED',
          result: {
            clusters: result.clusters,
            visiblePoints: result.visiblePoints,
            // 傳回 engine 判定的模式，主線程會以此決定要不要呈現 cluster markers
            isClustered: result.isClustered,
            // 若有需要，主線程也可以取用 bounds 內的所有點
            allPointsInBounds: result.allPointsInBounds || [],
            timestamp: Date.now(),
          },
        });
        break;
      }

      default:
        self.postMessage({ type: 'ERROR', message: `Unknown message type: ${type}` });
    }
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      message: error.message,
      stack: error.stack,
    });
  }
};

/**
 * 防止 Worker 被無謂暫停
 */
console.log('[ClusterWorker] Worker initialized and ready');
