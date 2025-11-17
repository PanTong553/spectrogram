# Zoom 後 Scroll Bar 偏移與 Time-Axis 同步問題修正

## 問題描述
在 zoom 後，spectrogram 底部的 scroll bar 會隨機向上偏移幾個像素，並且 time-axis 不能正確地自動跟著 scroll bar 移動。但當 resize browser window 後，scroll bar 就會回復原狀，time-axis 亦能變回正確地自動跟著 scroll bar 移動。

## 根本原因

### 1. **Time-Axis-Wrapper 寬度未更新**
- 在 zoom 後，`#time-axis` 的寬度被正確更新（在 `drawTimeAxis()` 中設定 `style.width`）
- 但其父容器 `#time-axis-wrapper` 的寬度 **沒有同步更新**
- 這導致 scroll bar 的軌道長度與實際內容寬度不匹配

### 2. **Scroll Bar 偏移的機制**
```
情況 1（zoom 後）:
┌─────────────────────────────────────────┐
│ #viewer-container (width: 2000px)      │  ← 因 zoom 變寬
│ content: scrollWidth = 2000px           │
└─────────────────────────────────────────┘
scrollbar track length: 相對於 clientWidth 計算

┌─────────────────────────────────────────┐
│ #time-axis-wrapper (width: 100%, 舊值)  │  ← 寬度未更新
│ content: #time-axis.width = 2000px      │  ← 被強制縮放
└─────────────────────────────────────────┘
scrollbar track length: 與 viewer-container 不同步

結果: scrollLeft 值看起來就像偏移了
```

### 3. **為何 Resize 就正常了？**
- Browser resize 觸發全面 reflow，CSS 重新計算所有寬度
- 或者 margin/padding 的重新計算導致視覺校正

## 修正方案

### 改動 1: `modules/axisRenderer.js` - 更新 time-axis-wrapper 寬度
```javascript
// 在 drawTimeAxis() 最後添加
const timeAxisWrapper = axisElement.parentElement;
if (timeAxisWrapper && timeAxisWrapper.id === 'time-axis-wrapper') {
  timeAxisWrapper.style.width = `${totalWidth}px`;
}
```
**作用：** 確保 time-axis-wrapper 的寬度與 time-axis 內容保持一致，scroll bar 軌道長度正確。

### 改動 2: `main.js` - renderAxes() 同步 scrollLeft
```javascript
// 在 updateProgressLine() 後添加
const timeAxisWrapper = document.getElementById('time-axis-wrapper');
if (timeAxisWrapper) {
  timeAxisWrapper.scrollLeft = container.scrollLeft;
}
```
**作用：** 強制確保 time-axis-wrapper 的 scrollLeft 與 viewer-container 同步，防止任何位置差異。

### 改動 3: `modules/wsManager.js` - 加強雙向 Scroll 同步
```javascript
// 原本: 單向同步 (source → target)
source.addEventListener('scroll', () => {
  target.scrollLeft = source.scrollLeft;
});

// 修正後: 雙向同步 + 防止無限迴圈
let isScrolling = false;

source.addEventListener('scroll', () => {
  if (isScrolling) return;
  isScrolling = true;
  target.scrollLeft = source.scrollLeft;
  requestAnimationFrame(() => { isScrolling = false; });
});

target.addEventListener('scroll', () => {
  if (isScrolling) return;
  isScrolling = true;
  source.scrollLeft = target.scrollLeft;
  requestAnimationFrame(() => { isScrolling = false; });
});
```
**作用：** 
- 支持雙向同步（使用者可以直接 scroll time-axis）
- 使用 `isScrolling` 旗標防止無限迴圈
- 用 `requestAnimationFrame` 確保異步完成後重置旗標

## 測試方案

### 1. 基本功能測試
```
步驟:
1. 載入音訊文件
2. 進行 zoom in / zoom out (使用按鈕或 Ctrl+↑/↓)
3. 觀察:
   ✓ Scroll bar 位置是否穩定（無偏移）
   ✓ Time-axis 是否跟著 scroll bar 移動
   ✓ Time-axis 寬度是否正確擴展
```

### 2. 邊界測試
```
步驟:
1. Zoom 到最小 (展開整個音訊)
2. Zoom 到最大 (最詳細的細節)
3. 在不同 zoom 層級之間快速切換
4. 觀察: scroll bar 是否保持穩定，scroll 位置是否正確同步
```

### 3. 交互測試
```
步驟:
1. Zoom in
2. 用滑鼠 scroll spectrogram
3. 觀察: time-axis 是否同步
4. 直接 scroll time-axis
5. 觀察: spectrogram 是否同步（雙向同步新功能）
```

### 4. DevTools 驗證
```
在 Chrome DevTools 中:
1. 執行 zoom
2. 檢查 console，確認沒有錯誤
3. 使用 Inspector 檢查 DOM:
   - #viewer-container width
   - #time-axis width
   - #time-axis-wrapper width (應該相同)
   - 比較 scrollLeft 值（應該相同）
```

## 技術細節

### CSS 相關設定（保持不變）
```css
#time-axis-wrapper {
  overflow: hidden;
  margin-left: 55px;  /* 與 freq-axis 寬度對應 */
}
#time-axis {
  height: 20px;
  font-size: 12px;
  position: relative;  /* 使用 position: relative 以支持 style.width */
}
```

### 寬度計算邏輯
```javascript
// zoom 後的實際寬度
totalWidth = duration * zoomLevel

// 例如:
// duration = 10 (秒)
// zoomLevel = 500 (px/sec)
// totalWidth = 5000 px
```

## 可能的後續優化

1. **使用 ResizeObserver** 監測 #viewer-container 寬度變化，自動更新 #time-axis-wrapper
2. **添加過渡動畫** 使 scroll 同步更平滑
3. **使用 Intersection Observer** 優化高 zoom 層級下的效能

## 相關文件修改
- ✅ `/workspaces/spectrogram/modules/axisRenderer.js`
- ✅ `/workspaces/spectrogram/main.js`
- ✅ `/workspaces/spectrogram/modules/wsManager.js`
