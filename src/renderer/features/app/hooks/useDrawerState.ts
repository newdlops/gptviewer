import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  DRAWER_COLLAPSE_THRESHOLD,
  DRAWER_DEFAULT_WIDTH,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
} from '../lib/appTypes';

export function useDrawerState() {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const committedDrawerWidthRef = useRef(DRAWER_DEFAULT_WIDTH);
  const draftDrawerWidthRef = useRef(DRAWER_DEFAULT_WIDTH);
  const resizeFrameRef = useRef<number | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(DRAWER_DEFAULT_WIDTH);
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(
    DRAWER_DEFAULT_WIDTH <= DRAWER_COLLAPSE_THRESHOLD,
  );
  const [isResizingDrawer, setIsResizingDrawer] = useState(false);
  const effectiveDrawerWidth = isDrawerCollapsed ? DRAWER_MIN_WIDTH : drawerWidth;

  useEffect(() => {
    if (!isResizingDrawer) return;

    const flushDrawerWidth = (nextWidth: number) => {
      const nextIsCollapsed = nextWidth <= DRAWER_COLLAPSE_THRESHOLD;
      const nextEffectiveWidth = nextIsCollapsed ? DRAWER_MIN_WIDTH : nextWidth;

      workspaceRef.current?.style.setProperty('--drawer-width', `${nextEffectiveWidth}px`);
      setIsDrawerCollapsed((current) => (current === nextIsCollapsed ? current : nextIsCollapsed));
    };

    const handleMouseMove = (event: MouseEvent) => {
      draftDrawerWidthRef.current = Math.min(
        DRAWER_MAX_WIDTH,
        Math.max(DRAWER_MIN_WIDTH, event.clientX),
      );
      if (resizeFrameRef.current !== null) return;
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        flushDrawerWidth(draftDrawerWidthRef.current);
      });
    };

    const handleMouseUp = () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      flushDrawerWidth(draftDrawerWidthRef.current);
      committedDrawerWidthRef.current = draftDrawerWidthRef.current;
      setDrawerWidth(draftDrawerWidthRef.current);
      setIsResizingDrawer(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingDrawer]);

  useEffect(() => {
    committedDrawerWidthRef.current = drawerWidth;
    workspaceRef.current?.style.setProperty('--drawer-width', `${effectiveDrawerWidth}px`);
  }, [drawerWidth, effectiveDrawerWidth]);

  const handleDrawerResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    draftDrawerWidthRef.current = committedDrawerWidthRef.current;
    setIsResizingDrawer(true);
  };

  return {
    handleDrawerResizeStart,
    isDrawerCollapsed,
    isResizingDrawer,
    workspaceRef,
  };
}
