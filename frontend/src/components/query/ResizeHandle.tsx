// query/ResizeHandle.tsx — drag handle for resizing the right config panel.

import React, { useCallback } from 'react';
import { cn } from '@/lib/utils';

interface ResizeHandleProps {
  currentWidth: number;
  onWidthChange: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  currentWidth,
  onWidthChange,
  minWidth = 400,
  maxWidth = 1200,
  className
}) => {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const startX = e.clientX;
    const startWidth = currentWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX; // Negative for left drag
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + deltaX));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [currentWidth, minWidth, maxWidth, onWidthChange]);

  return (
    <div
      className={cn(
        'absolute left-0 top-0 bottom-0 w-1',
        'cursor-col-resize hover:bg-blue-500 hover:w-2',
        'transition-all duration-150',
        className
      )}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
    />
  );
};

export default ResizeHandle;
