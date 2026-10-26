import { useEffect } from 'react';

/**
 * 浏览器标签页的“未查看完成”气泡。
 *
 * 由 project-workspace 模块在 `useProjectsState` 中调用：侧边栏的琥珀色
 * 呼吸点（attentionSessionIds）表示会话产生了新内容但用户还没点开，
 * 这里把同一个数量同步到浏览器标签：
 * 1. 在 favicon 右上角画一个带数字的琥珀色气泡，切换标签时也能看到；
 * 2. 通过 Badging API（安装为 PWA 时生效）同步到应用图标角标。
 *
 * 计数归零时恢复原始 favicon，不修改 document.title，避免与现有的
 * `[Done]` 标题标记互相覆盖。
 */

/** favicon 气泡的 DOM id，便于在计数变化时复用同一个 link 节点。 */
const BADGE_FAVICON_ID = 'attention-badge-favicon';
/** favicon 画布尺寸；浏览器会把图标缩放到标签页大小，64 足够清晰。 */
const BADGE_CANVAS_SIZE = 64;
/** 与侧边栏“需要处理”圆点保持一致的琥珀色。 */
const BADGE_COLOR = '#f59e0b';

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** 缓存底图加载结果，避免每次计数变化都重新请求 favicon。 */
let baseIconPromise: Promise<HTMLImageElement | null> | null = null;

/**
 * 读取页面当前的 PNG favicon 作为底图。
 *
 * 使用页面里已有的 link href 而不是写死 `/favicon.png`，这样部署在子路径
 * （例如 `/ai/`）时也能拿到正确的图标地址。
 */
function loadBaseIcon(): Promise<HTMLImageElement | null> {
  if (baseIconPromise) {
    return baseIconPromise;
  }

  baseIconPromise = new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/png"]');
    const source = iconLink?.href;
    if (!source) {
      resolve(null);
      return;
    }

    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });

  return baseIconPromise;
}

/** 生成右上角带数字气泡的 favicon data URL；canvas 不可用时返回 null。 */
async function buildBadgeFavicon(count: number): Promise<string | null> {
  const baseIcon = await loadBaseIcon();
  const canvas = document.createElement('canvas');
  canvas.width = BADGE_CANVAS_SIZE;
  canvas.height = BADGE_CANVAS_SIZE;

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  if (baseIcon) {
    context.drawImage(baseIcon, 0, 0, BADGE_CANVAS_SIZE, BADGE_CANVAS_SIZE);
  } else {
    // 底图加载失败时至少保留一个可识别的色块，气泡仍然可见。
    context.fillStyle = '#d77655';
    context.fillRect(0, 0, BADGE_CANVAS_SIZE, BADGE_CANVAS_SIZE);
  }

  const label = count > 9 ? '9+' : String(count);
  const radius = label.length > 1 ? 20 : 18;
  const centerX = BADGE_CANVAS_SIZE - radius - 2;
  const centerY = radius + 2;

  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fillStyle = BADGE_COLOR;
  context.fill();
  // 白色描边让气泡在深色/浅色底图上都能和图标区分开。
  context.lineWidth = 3;
  context.strokeStyle = '#ffffff';
  context.stroke();

  context.fillStyle = '#ffffff';
  context.font = `bold ${label.length > 1 ? 20 : 26}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, centerX, centerY + 1);

  return canvas.toDataURL('image/png');
}

/** 写入或移除生成的 favicon link；传 null 表示恢复页面原始图标。 */
function applyFavicon(url: string | null): void {
  const existing = document.getElementById(BADGE_FAVICON_ID) as HTMLLinkElement | null;

  if (!url) {
    existing?.remove();
    return;
  }

  const link = existing ?? document.createElement('link');
  link.id = BADGE_FAVICON_ID;
  link.rel = 'icon';
  link.type = 'image/png';
  link.sizes = '64x64';
  link.href = url;

  // 追加到 head 末尾，确保浏览器优先采用带气泡的图标。
  if (!existing) {
    document.head.appendChild(link);
  }
}

/** 同步 PWA 应用图标角标；浏览器不支持时静默跳过。 */
function applyAppBadge(count: number): void {
  const badgeNavigator = navigator as BadgeNavigator;

  try {
    if (count > 0) {
      void badgeNavigator.setAppBadge?.(count);
    } else {
      void badgeNavigator.clearAppBadge?.();
    }
  } catch {
    // 角标只是增强信息，失败不能影响页面。
  }
}

/**
 * jsdom 没有 canvas 实现，调用 getContext 会向测试输出刷 "Not implemented"。
 * 运行在真实浏览器里才需要绘制 favicon。
 */
function canRenderFavicon(): boolean {
  return (
    typeof navigator !== 'undefined'
    && !/jsdom/i.test(navigator.userAgent)
  );
}

/** Used by useProjectsState to mirror the attention-session count onto the browser tab. */
export function useAttentionTabBadge(count: number): void {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (count <= 0) {
      applyFavicon(null);
      applyAppBadge(0);
      return;
    }

    if (!canRenderFavicon()) {
      applyAppBadge(count);
      return;
    }

    let cancelled = false;
    void buildBadgeFavicon(count)
      // canvas 在部分环境（例如 jsdom）不可用，气泡失败不能抛出未处理异常。
      .catch(() => null)
      .then((faviconUrl) => {
        if (cancelled) {
          return;
        }

        if (faviconUrl) {
          applyFavicon(faviconUrl);
        }
        applyAppBadge(count);
      });

    return () => {
      cancelled = true;
    };
  }, [count]);
}
