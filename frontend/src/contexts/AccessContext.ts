import { createContext } from 'react';

export const AccessContext = createContext<{ enabled: boolean; logout: () => Promise<void> }>({
  enabled: false,
  logout: async () => {},
});
