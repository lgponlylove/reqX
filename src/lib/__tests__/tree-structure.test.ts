import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../stores/app';
import type { Collection, Dir, ApiRequest } from '../../types/api';

describe('Tree Structure Reordering and JSON Tree', () => {
  beforeEach(() => {
    useAppStore.setState({
      dirs: [
        { id: 'dir_1', name: 'Thư mục A', collectionIds: ['col_1'], parentId: null },
        { id: 'dir_2', name: 'Thư mục B', collectionIds: [], parentId: null },
      ],
      collections: [
        {
          id: 'col_1',
          name: 'Collection 1',
          rootRequestIds: ['req_1'],
          folders: [
            { id: 'fld_1', name: 'Folder 1', requestIds: ['req_2'], folderIds: [] },
          ],
        },
      ],
      requests: {
        req_1: {
          id: 'req_1',
          name: 'Request Root',
          method: 'GET',
          url: 'https://api.example.com/1',
          params: [],
          headers: [],
          bodyType: 'none',
          body: '',
          auth: { type: 'none' },
          updatedAt: Date.now(),
        },
        req_2: {
          id: 'req_2',
          name: 'Request in Folder',
          method: 'POST',
          url: 'https://api.example.com/2',
          params: [],
          headers: [],
          bodyType: 'none',
          body: '',
          auth: { type: 'none' },
          updatedAt: Date.now(),
        },
      },
    });
  });

  it('reorders collections and dirs via reorderTree properly', () => {
    const store = useAppStore.getState();

    // Di chuyển col_1 sang dir_2 và chuyển req_2 ra ngoài root
    const updatedTree = [
      {
        id: 'dir_2',
        name: 'Thư mục B đã đổi tên',
        type: 'dir',
        children: [
          {
            id: 'col_1',
            name: 'Collection 1 (renamed)',
            type: 'collection',
            children: [
              {
                id: 'fld_1',
                name: 'Folder 1 (empty)',
                type: 'folder',
                children: [],
              },
              {
                id: 'req_1',
                name: 'Request Root',
                type: 'request',
              },
              {
                id: 'req_2',
                name: 'Request in Folder',
                type: 'request',
              },
            ],
          },
        ],
      },
      {
        id: 'dir_1',
        name: 'Thư mục A',
        type: 'dir',
        children: [],
      },
    ];

    store.reorderTree(updatedTree);

    const nextState = useAppStore.getState();
    const dir2 = nextState.dirs.find((d) => d.id === 'dir_2');
    expect(dir2?.name).toBe('Thư mục B đã đổi tên');
    expect(dir2?.collectionIds).toContain('col_1');

    const col1 = nextState.collections.find((c) => c.id === 'col_1');
    expect(col1?.name).toBe('Collection 1 (renamed)');
    expect(col1?.rootRequestIds).toContain('req_1');
    expect(col1?.rootRequestIds).toContain('req_2');

    const fld1 = col1?.folders.find((f) => f.id === 'fld_1');
    expect(fld1?.requestIds).toEqual([]);
  });
});
