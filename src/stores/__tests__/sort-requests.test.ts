import { describe, expect, it } from 'vitest';
import { useAppStore } from '../app';
import { DEFAULT_REQUEST, type ApiRequest, type Collection, type Folder } from '../../types/api';

describe('Sort Requests in Folders and Collections', () => {
  it('sorts requests inside a folder A -> Z and Z -> A numerically', () => {
    const colId = 'col_test';
    const folderId = 'folder_test';

    const reqs: Record<string, ApiRequest> = {
      r1: { ...DEFAULT_REQUEST, id: 'r1', name: 'order 10', updatedAt: 1 },
      r2: { ...DEFAULT_REQUEST, id: 'r2', name: 'order 2', updatedAt: 1 },
      r3: { ...DEFAULT_REQUEST, id: 'r3', name: 'order 1', updatedAt: 1 },
      r4: { ...DEFAULT_REQUEST, id: 'r4', name: 'banana', updatedAt: 1 },
      r5: { ...DEFAULT_REQUEST, id: 'r5', name: 'apple', updatedAt: 1 },
    };

    const folder: Folder = {
      id: folderId,
      name: 'Receipts',
      requestIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
      folderIds: [],
    };

    const col: Collection = {
      id: colId,
      name: 'Test Col',
      folders: [folder],
      rootRequestIds: [],
    };

    useAppStore.setState({
      collections: [col],
      requests: reqs,
    });

    // Sort Ascending
    useAppStore.getState().sortFolderRequests(colId, folderId, 'asc');
    let updatedCol = useAppStore.getState().collections.find((c) => c.id === colId);
    let updatedFolder = updatedCol?.folders.find((f) => f.id === folderId);
    expect(updatedFolder?.requestIds).toEqual(['r5', 'r4', 'r3', 'r2', 'r1']); // apple, banana, order 1, order 2, order 10

    // Sort Descending
    useAppStore.getState().sortFolderRequests(colId, folderId, 'desc');
    updatedCol = useAppStore.getState().collections.find((c) => c.id === colId);
    updatedFolder = updatedCol?.folders.find((f) => f.id === folderId);
    expect(updatedFolder?.requestIds).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']); // order 10, order 2, order 1, banana, apple
  });

  it('sorts collection root requests and all child folders', () => {
    const colId = 'col_2';
    const folderId = 'f_1';

    const reqs: Record<string, ApiRequest> = {
      c_r1: { ...DEFAULT_REQUEST, id: 'c_r1', name: 'Zebra', updatedAt: 1 },
      c_r2: { ...DEFAULT_REQUEST, id: 'c_r2', name: 'Ant', updatedAt: 1 },
      f_r1: { ...DEFAULT_REQUEST, id: 'f_r1', name: 'Dog', updatedAt: 1 },
      f_r2: { ...DEFAULT_REQUEST, id: 'f_r2', name: 'Cat', updatedAt: 1 },
    };

    const folder: Folder = {
      id: folderId,
      name: 'Animals',
      requestIds: ['f_r1', 'f_r2'],
      folderIds: [],
    };

    const col: Collection = {
      id: colId,
      name: 'Animals Collection',
      folders: [folder],
      rootRequestIds: ['c_r1', 'c_r2'],
    };

    useAppStore.setState({
      collections: [col],
      requests: reqs,
    });

    useAppStore.getState().sortCollectionRequests(colId, 'asc');
    const updated = useAppStore.getState().collections.find((c) => c.id === colId);
    expect(updated?.rootRequestIds).toEqual(['c_r2', 'c_r1']); // Ant, Zebra
    expect(updated?.folders[0].requestIds).toEqual(['f_r2', 'f_r1']); // Cat, Dog
  });
});
