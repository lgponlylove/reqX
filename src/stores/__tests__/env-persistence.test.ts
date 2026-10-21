import { describe, expect, it } from 'vitest';
import { useAppStore } from '../app';
import { useRequestStore } from '../request';

describe('Environment Variable Persistence & Secret Protection', () => {
  it('does not strip variables containing secret/authorization keywords from storage partialize', () => {
    const appState = useAppStore.getState();
    const mockEnv = {
      id: 'env_live',
      name: 'shome-live',
      variables: {
        'Authorization-cobra-service-wms-bus': 'Bearer secret-token-12345',
        'api_key': 'key_abc_xyz',
        'baseUrl': 'https://api.shome.vn',
      },
    };

    useAppStore.setState({
      environments: [mockEnv],
      activeEnvId: 'env_live',
      envSecrets: {
        env_live: ['Authorization-cobra-service-wms-bus', 'api_key'],
      },
      globals: {
        'global_token': 'g-tok-999',
      },
      globalSecrets: ['global_token'],
    });

    const storeOptions = (useAppStore as any).persist?.getOptions();
    if (storeOptions?.partialize) {
      const persisted = storeOptions.partialize(useAppStore.getState());

      // Variables must NOT be wiped on disk/localStorage
      const env = persisted.environments.find((e: any) => e.id === 'env_live');
      expect(env).toBeDefined();
      expect(env.variables['Authorization-cobra-service-wms-bus']).toBe('Bearer secret-token-12345');
      expect(env.variables['api_key']).toBe('key_abc_xyz');
      expect(env.variables['baseUrl']).toBe('https://api.shome.vn');
      expect(persisted.globals['global_token']).toBe('g-tok-999');
    }
  });

  it('preserves tab request auth data in request store partialize', () => {
    const reqOptions = (useRequestStore as any).persist?.getOptions();
    if (reqOptions?.partialize) {
      const state = {
        tabs: [
          {
            id: 'tab_1',
            request: {
              id: 'req_1',
              url: 'https://api.example.com',
              headers: [
                { id: 'h1', key: 'Authorization', value: '{{Authorization-cobra-service-wms-bus}}', enabled: true },
              ],
              auth: { type: 'bearer' as const, token: 'secret-token-xyz' },
            },
          },
        ],
        activeId: 'tab_1',
      };
      const persisted = reqOptions.partialize(state);
      expect(persisted.tabs[0].request.auth.token).toBe('secret-token-xyz');
      expect(persisted.tabs[0].request.headers[0].value).toBe('{{Authorization-cobra-service-wms-bus}}');
    }
  });
});
