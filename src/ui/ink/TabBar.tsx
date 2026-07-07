import React from 'react';
import { Box, Text } from 'ink';
import { colors } from './theme.js';

export type ActiveTab = 'session' | 'issues' | 'prs' | 'gists';

export interface TabBarProps {
  activeTab: ActiveTab;
  cols: number;
  isGitRepo: boolean;
}

interface Tab {
  id: ActiveTab;
  label: string;
}

const TABS: Tab[] = [
  { id: 'session',  label: 'Session' },
  { id: 'issues',   label: 'Issues' },
  { id: 'prs',      label: 'Pull requests' },
  { id: 'gists',    label: 'Gists' },
];

export function TabBar({ activeTab, cols, isGitRepo }: TabBarProps): React.ReactElement {
  const narrow = cols < 60;

  const visibleTabs = narrow ? TABS.filter(t => t.id === activeTab) : TABS;

  return (
    <Box width="100%">
      {visibleTabs.map((tab, i) => {
        const isActive = tab.id === activeTab;
        const isRepoTab = tab.id === 'issues' || tab.id === 'prs';
        const extraDim = isRepoTab && !isGitRepo && !isActive;
        const gap = i > 0 ? '   ' : '';

        if (isActive) {
          return (
            <React.Fragment key={tab.id}>
              {gap ? <Text>{gap}</Text> : null}
              {/* backgroundColor is supported at runtime in Ink v5 but missing from types */}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Text bold color="white" {...{ backgroundColor: '#1F6FEB' } as any}>{` [${tab.label}] `}</Text>
            </React.Fragment>
          );
        }

        return (
          <React.Fragment key={tab.id}>
            {gap ? <Text>{gap}</Text> : null}
            <Text dimColor={true} color={extraDim ? '#586069' : colors.muted}>{` ${tab.label} `}</Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
}
