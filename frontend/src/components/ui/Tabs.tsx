import React from 'react';

export interface Tab {
  id: string;
  label: string;
  icon?: string;
}

export interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange }) => {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--spacing-sm)',
    borderBottom: `1px solid var(--color-border-light)`,
    marginBottom: 'var(--spacing-lg)',
  };

  const buttonStyle = (isActive: boolean): React.CSSProperties => ({
    padding: 'var(--spacing-sm) var(--spacing-md)',
    fontSize: 'var(--font-size-base)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'background-color var(--transition-normal), color var(--transition-normal), border-color var(--transition-normal)',
    backgroundColor: isActive ? 'var(--color-primary)' : 'transparent',
    color: isActive ? 'white' : 'var(--color-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-xs)',
    fontFamily: 'inherit',
  });

  return (
    <div style={containerStyle}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          style={buttonStyle(activeTab === tab.id)}
          onClick={() => onChange(tab.id)}
          aria-selected={activeTab === tab.id}
          role="tab"
        >
          {tab.icon && <span>{tab.icon}</span>}
          {tab.label}
        </button>
      ))}
    </div>
  );
};
