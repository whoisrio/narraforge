import { createContext, useContext, type ReactNode } from 'react';

interface ThemeContextValue {
  theme: 'light';
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'light' });

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={{ theme: 'light' }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  return useContext(ThemeContext);
}
