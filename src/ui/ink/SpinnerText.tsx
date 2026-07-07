import React, { useEffect, useState } from 'react';
import { Text } from 'ink';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Isolated spinner component — has its own state so ONLY this tiny component
 * re-renders every tick, NOT the entire App tree.  This prevents the 4 GB OOM
 * caused by App.tsx re-rendering 1 700+ times during a long LLM response.
 */
export const SpinnerText: React.FC<{ color?: string }> = ({ color = 'blue' }) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 100);
    return () => clearInterval(t);
  }, []);

  return <Text color={color}>{FRAMES[frame] ?? '⠋'}{' '}</Text>;
};
