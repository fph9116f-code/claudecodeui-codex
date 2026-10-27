import { useRef, useState } from 'react';

import { cn } from '@/shared/utils';

type HoverScrollTextProps = {
  /** Full text to reveal; the row only has room for its beginning until hovered. */
  text: string;
  className?: string;
};

/** 悬停滚动速度：每秒移动的像素数，约等于一行字的阅读速度。 */
const SCROLL_SPEED_PX_PER_SECOND = 45;
/** 最短滚动时长，避免只溢出几个像素时闪一下就结束。 */
const MIN_SCROLL_DURATION_MS = 600;
/** 最长滚动时长，超长标题也不会让用户等太久。 */
const MAX_SCROLL_DURATION_MS = 12000;

/**
 * 单行文本，悬停时自动横向滚动到末尾，用于侧边栏被截断的会话标题。
 *
 * 默认保留 CSS `truncate` 的省略号；悬停后临时取消截断并平移文本，让外层
 * `overflow-hidden` 露出被截掉的结尾。滚动距离和时长按实际溢出宽度计算，
 * 文本放得下时不会产生任何动画；系统开启“减少动态效果”时保持静态。
 */
export default function HoverScrollText({ text, className }: HoverScrollTextProps) {
  const textRef = useRef<HTMLSpanElement | null>(null);
  // 文本需要平移的像素数；0 表示尚未悬停或文本本来就能完整显示。
  const [offset, setOffset] = useState(0);
  // 平移动画时长，按溢出宽度换算，保证长标题的滚动速度一致。
  const [duration, setDuration] = useState(0);

  const scrollToEnd = () => {
    const element = textRef.current;
    if (!element) {
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const overflow = element.scrollWidth - element.clientWidth;
    if (overflow <= 1) {
      return;
    }

    setOffset(overflow);
    setDuration(
      Math.min(
        MAX_SCROLL_DURATION_MS,
        Math.max(
          MIN_SCROLL_DURATION_MS,
          Math.round((overflow / SCROLL_SPEED_PX_PER_SECOND) * 1000),
        ),
      ),
    );
  };

  const resetScroll = () => {
    setOffset(0);
    // 离开时立即回到标题开头，避免反向动画拖沓。
    setDuration(0);
  };

  const isScrolling = offset > 0;

  return (
    <div
      className={cn('min-w-0 flex-1 overflow-hidden', className)}
      title={text}
      onMouseEnter={scrollToEnd}
      onMouseLeave={resetScroll}
    >
      <span
        ref={textRef}
        className={cn(
          'block transition-transform ease-linear',
          // 悬停时取消截断，让文本能够完整布局并平移到可视区。
          isScrolling ? 'whitespace-nowrap' : 'truncate',
        )}
        style={{
          transform: isScrolling ? `translateX(-${offset}px)` : undefined,
          transitionDuration: `${duration}ms`,
        }}
      >
        {text}
      </span>
    </div>
  );
}
