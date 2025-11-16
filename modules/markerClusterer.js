/**
 * 高效的 Marker 聚類系統
 * - 支援動態聚類/解聚
 * - 使用 QuadTree 加速空間查詢
 * - 適配 zoom level 的動態半徑調整
 */

/**
 * 簡單 QuadTree 實現 - 用於快速空間查詢
 */
class QuadTree {
  constructor(bounds, maxPoints = 4, maxDepth = 8) {
    this.bounds = bounds; // { minLat, maxLat, minLng, maxLng }
    this.maxPoints = maxPoints;
    this.maxDepth = maxDepth;
    this.points = [];
    this.children = null;
    this.depth = 0;
  }

  insert(point) {
    // point = { lat, lng, data, id }
    if (!this.contains(point)) return false;

    if (this.children === null && this.points.length < this.maxPoints) {
      this.points.push(point);
      return true;
    }

    if (this.children === null && this.depth < this.maxDepth) {
      this.subdivide();
    }

    if (this.children !== null) {
      for (let child of this.children) {
        if (child.insert(point)) return true;
      }
    } else {
      this.points.push(point);
    }
    return true;
  }

  subdivide() {
    const { minLat, maxLat, minLng, maxLng } = this.bounds;
    const midLat = (minLat + maxLat) / 2;
    const midLng = (minLng + maxLng) / 2;

    this.children = [
      new QuadTree({ minLat, maxLat: midLat, minLng, maxLng: midLng }, this.maxPoints, this.maxDepth),
      new QuadTree({ minLat: midLat, maxLat, minLng, maxLng: midLng }, this.maxPoints, this.maxDepth),
      new QuadTree({ minLat, maxLat: midLat, minLng: midLng, maxLng }, this.maxPoints, this.maxDepth),
      new QuadTree({ minLat: midLat, maxLat, minLng: midLng, maxLng }, this.maxPoints, this.maxDepth),
    ];

    for (let child of this.children) child.depth = this.depth + 1;

    for (let point of this.points) {
      for (let child of this.children) {
        if (child.insert(point)) break;
      }
    }
    this.points = [];
  }

  contains(point) {
    const { minLat, maxLat, minLng, maxLng } = this.bounds;
    return point.lat >= minLat && point.lat <= maxLat && point.lng >= minLng && point.lng <= maxLng;
  }

  query(bounds) {
    // 查詢範圍內的所有點 bounds = { minLat, maxLat, minLng, maxLng }
    const result = [];
    if (!this.intersects(bounds)) return result;

    for (let point of this.points) {
      if (this.pointInBounds(point, bounds)) {
        result.push(point);
      }
    }

    if (this.children) {
      for (let child of this.children) {
        result.push(...child.query(bounds));
      }
    }

    return result;
  }

  intersects(bounds) {
    const { minLat, maxLat, minLng, maxLng } = this.bounds;
    const { minLat: qMinLat, maxLat: qMaxLat, minLng: qMinLng, maxLng: qMaxLng } = bounds;
    return !(qMaxLat < minLat || qMinLat > maxLat || qMaxLng < minLng || qMinLng > maxLng);
  }

  pointInBounds(point, bounds) {
    const { minLat, maxLat, minLng, maxLng } = bounds;
    return point.lat >= minLat && point.lat <= maxLat && point.lng >= minLng && point.lng <= maxLng;
  }

  clear() {
    this.points = [];
    this.children = null;
  }
}

/**
 * 聚類計算引擎
 */
class ClusterEngine {
  constructor(points = []) {
    this.allPoints = points; // { id, lat, lng, meta }
    this.quadTree = null;
    this.buildIndex();
  }

  buildIndex() {
    if (this.allPoints.length === 0) return;

    const lats = this.allPoints.map(p => p.lat);
    const lngs = this.allPoints.map(p => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    // 加入小的緩衝以避免邊界問題
    const padding = 0.01;
    this.quadTree = new QuadTree(
      { minLat: minLat - padding, maxLat: maxLat + padding, minLng: minLng - padding, maxLng: maxLng + padding },
      6,
      10
    );

    for (let point of this.allPoints) {
      this.quadTree.insert({ lat: point.lat, lng: point.lng, data: point, id: point.id });
    }
  }

  updatePoints(points) {
    this.allPoints = points;
    this.quadTree = null;
    this.buildIndex();
  }

  /**
   * 根據 zoom level 計算聚類半徑
   * zoom 越小 -> 半徑越大 -> 聚類越密集
   */
  getClusterRadiusForZoom(zoom, visiblePointCount = 0) {
    if (zoom >= 14 && visiblePointCount < 300) return -1; // -1 表示禁用聚類
    if (zoom >= 16) return 0; // 16+: 不聚類
    if (zoom >= 14) return 0.01; // 14-15: 最小聚類
    if (zoom >= 12) return 0.03;
    if (zoom >= 10) return 0.1;
    if (zoom >= 8) return 0.2;
    return 0.5; // zoom < 8: 最大聚類範圍
  }

  /**
   * 計算聚類（基於 zoom level）
   * 回傳 { clusters: [...], visiblePoints: [...], isClustered: boolean }
   */
  computeClusters(zoom, mapBounds) {
    // 查詢邊界內的點
    const pointsInBounds = this.quadTree.query(mapBounds);
    
    // 檢查是否應禁用聚類
    const radiusLatitude = this.getClusterRadiusForZoom(zoom, pointsInBounds.length);
    
    // 高 zoom level 且點數少於250時禁用聚類
    if (radiusLatitude === -1) {
      const visiblePoints = pointsInBounds.map(p => p.data);
      return { 
        clusters: [], 
        visiblePoints, 
        allPointsInBounds: visiblePoints,
        isClustered: false // 標記不使用聚類
      };
    }

    const radiusLongitude = radiusLatitude / Math.cos((mapBounds.minLat + mapBounds.maxLat) / 2 * Math.PI / 180);

    const clusters = [];
    const clustered = new Set();
    const visiblePoints = [];

    // 先嘗試聚類
    for (let point of pointsInBounds) {
      if (clustered.has(point.id)) continue;

      const nearby = pointsInBounds.filter(
        p =>
          !clustered.has(p.id) &&
          Math.abs(p.lat - point.lat) <= radiusLatitude &&
          Math.abs(p.lng - point.lng) <= radiusLongitude
      );

      if (nearby.length > 1) {
        // 形成聚類 - 先過濾有效的點
        const clusterPoints = nearby.map(p => p.data);
        const validClusterPoints = clusterPoints.filter(p => {
          const lat = Number(p.lat);
          const lng = Number(p.lng);
          return isFinite(lat) && isFinite(lng);
        });

        if (validClusterPoints.length === 0) {
          // 如果沒有有效的點，跳過這個聚類
          clustered.add(point.id);
          continue;
        }

        const centerLat = validClusterPoints.reduce((sum, p) => sum + Number(p.lat), 0) / validClusterPoints.length;
        const centerLng = validClusterPoints.reduce((sum, p) => sum + Number(p.lng), 0) / validClusterPoints.length;

        clusters.push({
          id: `cluster_${clusters.length}`,
          lat: centerLat,
          lng: centerLng,
          count: validClusterPoints.length,
          points: clusterPoints,  // 保留所有點（包括無效的）用於其他用途
        });

        for (let p of nearby) {
          clustered.add(p.id);
        }
      } else {
        clustered.add(point.id);
      }
    }

    // 收集未聚類的點
    for (let point of pointsInBounds) {
      if (!clustered.has(point.id)) {
        visiblePoints.push(point.data);
      }
    }

    return { 
      clusters, 
      visiblePoints, 
      allPointsInBounds: pointsInBounds.map(p => p.data),
      isClustered: true // 標記使用聚類
    };
  }

  /**
   * 哈弗辛公式計算兩點距離（單位：公里）
   */
  static haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // 地球半徑
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

export { QuadTree, ClusterEngine };
