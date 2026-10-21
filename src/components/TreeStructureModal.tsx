import React, { useState, useMemo } from 'react';
import { useAppStore } from '../stores/app';
import type { Dir, Collection, Folder, ApiRequest } from '../types/api';

export interface TreeStructureItem {
  id: string;
  name: string;
  type: 'dir' | 'collection' | 'folder' | 'request';
  method?: string;
  children?: TreeStructureItem[];
}

interface TreeStructureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TreeStructureModal({ isOpen, onClose }: TreeStructureModalProps) {
  const dirs = useAppStore((s) => s.dirs);
  const collections = useAppStore((s) => s.collections);
  const requests = useAppStore((s) => s.requests);
  const reorderTree = useAppStore((s) => s.reorderTree);
  const moveRequestToCollection = useAppStore((s) => s.moveRequestToCollection);
  const moveRequest = useAppStore((s) => s.moveRequest);
  const moveCollection = useAppStore((s) => s.moveCollection);
  const moveDir = useAppStore((s) => s.moveDir);

  const [activeTab, setActiveTab] = useState<'visual' | 'json'>('visual');
  const [jsonText, setJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonSuccess, setJsonSuccess] = useState<string | null>(null);

  // Selected item for quick move in Visual tab
  const [selectedTarget, setSelectedTarget] = useState<{
    type: 'dir' | 'collection' | 'folder' | 'request';
    id: string;
    name: string;
    currentParentId?: string | null;
  } | null>(null);
  const [destinationChoice, setDestinationChoice] = useState<string>('');

  // Xây dựng cây phân cấp chuẩn
  const treeData = useMemo(() => {
    // Helper tìm requests
    const getReqItem = (reqId: string): TreeStructureItem | null => {
      const r = requests[reqId];
      if (!r) return null;
      return {
        id: r.id,
        name: r.name || '(Không tên)',
        type: 'request',
        method: r.method,
      };
    };

    // Helper folder (đệ quy nested folders)
    const buildFolderNode = (f: Folder, allFolders: Folder[]): TreeStructureItem => {
      const childFolderItems: TreeStructureItem[] = (f.folderIds ?? [])
        .map((childId) => allFolders.find((x) => x.id === childId))
        .filter((x): x is Folder => !!x)
        .map((child) => buildFolderNode(child, allFolders));

      const reqItems: TreeStructureItem[] = (f.requestIds ?? [])
        .map(getReqItem)
        .filter((x): x is TreeStructureItem => !!x);

      return {
        id: f.id,
        name: f.name,
        type: 'folder',
        children: [...childFolderItems, ...reqItems],
      };
    };

    // Helper collection
    const buildColNode = (c: Collection): TreeStructureItem => {
      // Top-level folders (không nằm trong folderIds của ai)
      const childFolderIdSet = new Set<string>();
      for (const f of c.folders) {
        for (const cid of f.folderIds ?? []) childFolderIdSet.add(cid);
      }
      const topFolders = c.folders.filter((f) => !childFolderIdSet.has(f.id));
      const folderNodes = topFolders.map((f) => buildFolderNode(f, c.folders));

      const rootReqs: TreeStructureItem[] = (c.rootRequestIds ?? [])
        .map(getReqItem)
        .filter((x): x is TreeStructureItem => !!x);

      return {
        id: c.id,
        name: c.name,
        type: 'collection',
        children: [...folderNodes, ...rootReqs],
      };
    };

    // Helper dir
    const buildDirNode = (d: Dir): TreeStructureItem => {
      const subDirs = dirs
        .filter((x) => (x.parentId ?? null) === d.id)
        .map(buildDirNode);

      const colNodes = d.collectionIds
        .map((cid) => collections.find((c) => c.id === cid))
        .filter((x): x is Collection => !!x)
        .map(buildColNode);

      return {
        id: d.id,
        name: d.name,
        type: 'dir',
        children: [...subDirs, ...colNodes],
      };
    };

    const rootDirs = dirs
      .filter((d) => !d.parentId)
      .map(buildDirNode);

    // Unfiled collections
    const unfiledCols = collections
      .filter((c) => !dirs.some((d) => d.collectionIds.includes(c.id)))
      .map(buildColNode);

    const result: TreeStructureItem[] = [...rootDirs];
    if (unfiledCols.length > 0) {
      if (rootDirs.length > 0) {
        result.push({
          id: 'unfiled-wrapper',
          name: 'Ngoài thư mục (Unfiled Collections)',
          type: 'dir',
          children: unfiledCols,
        });
      } else {
        result.push(...unfiledCols);
      }
    }

    return result;
  }, [dirs, collections, requests]);

  // Khi chuyển sang tab JSON, load lại chuỗi JSON mới nhất
  const openJsonTab = () => {
    setActiveTab('json');
    setJsonText(JSON.stringify(treeData, null, 2));
    setJsonError(null);
    setJsonSuccess(null);
  };

  const applyJsonTree = () => {
    try {
      setJsonError(null);
      setJsonSuccess(null);
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        throw new Error('Dữ liệu JSON gốc phải là một danh sách mảng (Array).');
      }

      // Chuẩn hóa và áp dụng vào store
      if (reorderTree) {
        reorderTree(parsed);
      } else {
        // Fallback: cập nhật thông qua store reorderTree
        useAppStore.getState().reorderTree(parsed);
      }
      setJsonSuccess('✓ Đã cập nhật và sắp xếp lại toàn bộ cấu trúc cây thành công!');
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  };

  // Di chuyển nhanh trong Visual tab
  const handleMoveVisual = () => {
    if (!selectedTarget || !destinationChoice) return;

    if (selectedTarget.type === 'request') {
      // destinationChoice: 'col:{colId}:root' hoặc 'col:{colId}:fld:{fldId}'
      const parts = destinationChoice.split(':');
      if (parts[0] === 'col' && parts[2] === 'root') {
        const toColId = parts[1];
        // Tìm fromColId
        const fromCol = collections.find(
          (c) => c.rootRequestIds.includes(selectedTarget.id) || c.folders.some((f) => f.requestIds.includes(selectedTarget.id))
        );
        if (fromCol) {
          if (fromCol.id === toColId) {
            moveRequest(toColId, selectedTarget.id, 'root');
          } else {
            moveRequestToCollection(fromCol.id, selectedTarget.id, toColId, 'root');
          }
        }
      } else if (parts[0] === 'col' && parts[2] === 'fld') {
        const toColId = parts[1];
        const toFolderId = parts[3];
        const fromCol = collections.find(
          (c) => c.rootRequestIds.includes(selectedTarget.id) || c.folders.some((f) => f.requestIds.includes(selectedTarget.id))
        );
        if (fromCol) {
          if (fromCol.id === toColId) {
            moveRequest(toColId, selectedTarget.id, { folderId: toFolderId });
          } else {
            moveRequestToCollection(fromCol.id, selectedTarget.id, toColId, { folderId: toFolderId });
          }
        }
      }
    } else if (selectedTarget.type === 'collection') {
      // destinationChoice: 'dir:null' hoặc 'dir:{dirId}'
      if (destinationChoice === 'dir:null') {
        moveCollection(selectedTarget.id, null);
      } else if (destinationChoice.startsWith('dir:')) {
        const targetDirId = destinationChoice.replace('dir:', '');
        moveCollection(selectedTarget.id, targetDirId);
      }
    } else if (selectedTarget.type === 'dir') {
      // destinationChoice: 'dir:null' hoặc 'dir:{dirId}'
      if (destinationChoice === 'dir:null') {
        moveDir(selectedTarget.id, null);
      } else if (destinationChoice.startsWith('dir:')) {
        const targetDirId = destinationChoice.replace('dir:', '');
        if (targetDirId !== selectedTarget.id) {
          moveDir(selectedTarget.id, targetDirId);
        }
      }
    }

    setSelectedTarget(null);
    setDestinationChoice('');
  };

  // Reorder di chuyển Lên / Xuống (Up / Down) trong mảng cùng cấp
  const handleShiftItem = (type: 'dir' | 'collection' | 'folder' | 'request', id: string, direction: 'up' | 'down') => {
    if (type === 'collection') {
      const idx = collections.findIndex((c) => c.id === id);
      if (idx === -1) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= collections.length) return;
      const nextCols = [...collections];
      const [item] = nextCols.splice(idx, 1);
      nextCols.splice(targetIdx, 0, item);
      useAppStore.setState({ collections: nextCols });
    } else if (type === 'dir') {
      // Tìm dir và danh sách anh em cùng parentId
      const targetDir = dirs.find((d) => d.id === id);
      if (!targetDir) return;
      const siblings = dirs.filter((d) => (d.parentId ?? null) === (targetDir.parentId ?? null));
      const idx = siblings.findIndex((d) => d.id === id);
      if (idx === -1) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= siblings.length) return;
      
      // Swap order
      const nextDirs = [...dirs];
      const pos1 = nextDirs.findIndex((d) => d.id === siblings[idx].id);
      const pos2 = nextDirs.findIndex((d) => d.id === siblings[targetIdx].id);
      const tmp = nextDirs[pos1];
      nextDirs[pos1] = nextDirs[pos2];
      nextDirs[pos2] = tmp;
      useAppStore.setState({ dirs: nextDirs });
    } else if (type === 'request') {
      // Tìm collection chứa request
      const col = collections.find(
        (c) => c.rootRequestIds.includes(id) || c.folders.some((f) => f.requestIds.includes(id))
      );
      if (!col) return;
      if (col.rootRequestIds.includes(id)) {
        const idx = col.rootRequestIds.indexOf(id);
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= col.rootRequestIds.length) return;
        const nextIds = [...col.rootRequestIds];
        const [moved] = nextIds.splice(idx, 1);
        nextIds.splice(targetIdx, 0, moved);
        useAppStore.setState({
          collections: collections.map((c) => (c.id === col.id ? { ...c, rootRequestIds: nextIds } : c)),
        });
      } else {
        const folder = col.folders.find((f) => f.requestIds.includes(id));
        if (!folder) return;
        const idx = folder.requestIds.indexOf(id);
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= folder.requestIds.length) return;
        const nextIds = [...folder.requestIds];
        const [moved] = nextIds.splice(idx, 1);
        nextIds.splice(targetIdx, 0, moved);
        useAppStore.setState({
          collections: collections.map((c) =>
            c.id === col.id
              ? {
                  ...c,
                  folders: c.folders.map((f) => (f.id === folder.id ? { ...f, requestIds: nextIds } : f)),
                }
              : c
          ),
        });
      }
    } else if (type === 'folder') {
      const col = collections.find((c) => c.folders.some((f) => f.id === id));
      if (!col) return;
      const folder = col.folders.find((f) => f.id === id);
      if (!folder) return;

      // Tìm parent folder hoặc top-level
      const parentFolder = col.folders.find((f) => (f.folderIds ?? []).includes(id));
      if (parentFolder) {
        const fids = parentFolder.folderIds ?? [];
        const idx = fids.indexOf(id);
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= fids.length) return;
        const nextFids = [...fids];
        const [moved] = nextFids.splice(idx, 1);
        nextFids.splice(targetIdx, 0, moved);
        useAppStore.setState({
          collections: collections.map((c) =>
            c.id === col.id
              ? {
                  ...c,
                  folders: c.folders.map((f) => (f.id === parentFolder.id ? { ...f, folderIds: nextFids } : f)),
                }
              : c
          ),
        });
      } else {
        // Top-level folders trong collection
        const allChildFolderIds = new Set<string>();
        for (const f of col.folders) {
          for (const cid of f.folderIds ?? []) allChildFolderIds.add(cid);
        }
        const topFolders = col.folders.filter((f) => !allChildFolderIds.has(f.id));
        const idx = topFolders.findIndex((f) => f.id === id);
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= topFolders.length) return;

        // Hoán đổi vị trí của 2 folder trong col.folders
        const pos1 = col.folders.findIndex((f) => f.id === topFolders[idx].id);
        const pos2 = col.folders.findIndex((f) => f.id === topFolders[targetIdx].id);
        const nextFolders = [...col.folders];
        const tmp = nextFolders[pos1];
        nextFolders[pos1] = nextFolders[pos2];
        nextFolders[pos2] = tmp;
        useAppStore.setState({
          collections: collections.map((c) => (c.id === col.id ? { ...c, folders: nextFolders } : c)),
        });
      }
    }
  };

  if (!isOpen) return null;

  // Render từng item trong Visual Tree
  const renderVisualNode = (item: TreeStructureItem, depth: number = 0) => {
    const isUnfiledWrapper = item.id === 'unfiled-wrapper';

    return (
      <div key={item.id} className="flex flex-col">
        <div
          className={`flex items-center justify-between py-1 px-2 rounded hover:bg-slate-800/80 group transition-colors ${
            item.type === 'dir'
              ? 'bg-slate-800/40 text-amber-300 font-semibold text-xs mt-1'
              : item.type === 'collection'
              ? 'bg-teal-950/30 text-teal-300 font-medium text-xs mt-0.5'
              : item.type === 'folder'
              ? 'text-cyan-300 text-xs'
              : 'text-slate-300 text-xs hover:text-white'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
            {item.type === 'dir' && <span>📁</span>}
            {item.type === 'collection' && <span>🗂</span>}
            {item.type === 'folder' && <span>📂</span>}
            {item.type === 'request' && (
              <span
                className={`font-mono font-bold text-[10px] px-1 rounded ${
                  item.method === 'GET'
                    ? 'text-emerald-400 bg-emerald-950/60'
                    : item.method === 'POST'
                    ? 'text-amber-400 bg-amber-950/60'
                    : item.method === 'PUT'
                    ? 'text-blue-400 bg-blue-950/60'
                    : item.method === 'DELETE'
                    ? 'text-rose-400 bg-rose-950/60'
                    : 'text-purple-400 bg-purple-950/60'
                }`}
              >
                {item.method ?? 'REQ'}
              </span>
            )}
            <span className="truncate" title={item.name}>
              {item.name}
            </span>
          </div>

          {!isUnfiledWrapper && (
            <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 shrink-0">
              {/* Nút Lên / Xuống */}
              <button
                onClick={() => handleShiftItem(item.type, item.id, 'up')}
                title="Di chuyển lên trên"
                className="p-0.5 hover:bg-slate-700 rounded text-slate-400 hover:text-cyan-300 text-xs"
              >
                ▲
              </button>
              <button
                onClick={() => handleShiftItem(item.type, item.id, 'down')}
                title="Di chuyển xuống dưới"
                className="p-0.5 hover:bg-slate-700 rounded text-slate-400 hover:text-cyan-300 text-xs"
              >
                ▼
              </button>

              {/* Nút Chuyển nhanh vị trí */}
              <button
                onClick={() => {
                  setSelectedTarget({
                    type: item.type,
                    id: item.id,
                    name: item.name,
                  });
                  setDestinationChoice('');
                }}
                title="Chuyển đến vị trí/thư mục khác…"
                className="text-[11px] px-1.5 py-0.5 bg-slate-700 hover:bg-teal-600 text-slate-200 hover:text-white rounded ml-1 transition-colors"
              >
                Chuyển…
              </button>
            </div>
          )}
        </div>

        {item.children && item.children.length > 0 && (
          <div className="flex flex-col">
            {item.children.map((child) => renderVisualNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0b141e] border border-teal-500/40 rounded-2xl shadow-[0_0_40px_rgba(20,184,166,0.3)] w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden text-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-teal-500/20 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <span className="text-teal-400 text-lg">🌳</span>
            <h2 className="font-bold text-sm tracking-wide uppercase text-teal-300 font-mono">
              Quản lý Cấu trúc Cây Collections & Thư mục
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab switch */}
            <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setActiveTab('visual')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === 'visual'
                    ? 'bg-teal-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🌲 Cây Trực quan
              </button>
              <button
                onClick={openJsonTab}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === 'json'
                    ? 'bg-teal-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {'{ }'} Cấu trúc JSON
              </button>
            </div>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-rose-400 text-lg px-2 py-0.5 rounded hover:bg-slate-800 transition-colors"
              title="Đóng"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0">
          {activeTab === 'visual' ? (
            <div className="flex flex-col gap-3 flex-1 min-h-0">
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300 flex items-center justify-between">
                <span>
                  💡 <b>Mẹo:</b> Sử dụng nút <b>▲ / ▼</b> để đổi thứ tự trực tiếp, hoặc nút <b>Chuyển…</b> để di chuyển thư mục/collection/request đến bất kỳ đích nào một cách nhanh chóng.
                </span>
                <span className="text-teal-400 font-mono">
                  Tổng: {collections.length} collections
                </span>
              </div>

              {/* Popup Dialog chọn đích chuyển nhanh */}
              {selectedTarget && (
                <div className="p-3 bg-slate-900 border border-teal-500/50 rounded-xl flex flex-col gap-2 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-teal-300">
                      Chuyển <b>[{selectedTarget.type.toUpperCase()}] {selectedTarget.name}</b> tới:
                    </span>
                    <button
                      onClick={() => setSelectedTarget(null)}
                      className="text-slate-400 hover:text-white text-xs px-1"
                    >
                      ✕ Hủy
                    </button>
                  </div>

                  <div className="flex gap-2 items-center">
                    <select
                      value={destinationChoice}
                      onChange={(e) => setDestinationChoice(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1.5 text-xs outline-none focus:border-teal-400"
                    >
                      <option value="">-- Chọn nơi đến --</option>
                      {selectedTarget.type === 'request' && (
                        <>
                          {collections.map((c) => (
                            <React.Fragment key={c.id}>
                              <option value={`col:${c.id}:root`}>
                                📁 Collection: {c.name} (gốc)
                              </option>
                              {c.folders.map((f) => (
                                <option key={f.id} value={`col:${c.id}:fld:${f.id}`}>
                                  &nbsp;&nbsp;↳ 📂 Folder: {c.name} / {f.name}
                                </option>
                              ))}
                            </React.Fragment>
                          ))}
                        </>
                      )}

                      {(selectedTarget.type === 'collection' || selectedTarget.type === 'dir') && (
                        <>
                          <option value="dir:null">📁 Thư mục Gốc (Root / Ngoài thư mục)</option>
                          {dirs
                            .filter((d) => d.id !== selectedTarget.id)
                            .map((d) => (
                              <option key={d.id} value={`dir:${d.id}`}>
                                📁 Thư mục: {d.name}
                              </option>
                            ))}
                        </>
                      )}
                    </select>

                    <button
                      onClick={handleMoveVisual}
                      disabled={!destinationChoice}
                      className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded text-xs font-semibold"
                    >
                      Xác nhận chuyển
                    </button>
                  </div>
                </div>
              )}

              {/* Danh sách cây visual */}
              <div className="flex-1 border border-slate-800 bg-slate-950/70 rounded-xl p-2 overflow-y-auto space-y-0.5 min-h-[300px]">
                {treeData.map((node) => renderVisualNode(node))}
                {treeData.length === 0 && (
                  <div className="text-center py-10 text-slate-500 text-xs">
                    Chưa có Collection hay Thư mục nào.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 flex-1 min-h-0">
              <div className="text-xs text-slate-400 flex items-center justify-between">
                <span>
                  Chỉnh sửa trực tiếp file JSON cấu trúc cây bên dưới để định vị, di chuyển hoặc đổi vị trí các mục hàng loạt:
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(jsonText);
                    setJsonSuccess('Đã sao chép cấu trúc JSON vào Clipboard!');
                  }}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 text-xs"
                >
                  📋 Copy JSON
                </button>
              </div>

              {jsonError && (
                <div className="p-2 bg-rose-950/60 border border-rose-800 rounded-lg text-rose-300 text-xs flex items-center gap-1.5">
                  <span>⚠</span>
                  <span>{jsonError}</span>
                </div>
              )}

              {jsonSuccess && (
                <div className="p-2 bg-emerald-950/60 border border-emerald-800 rounded-lg text-emerald-300 text-xs flex items-center gap-1.5">
                  <span>✓</span>
                  <span>{jsonSuccess}</span>
                </div>
              )}

              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setJsonError(null);
                  setJsonSuccess(null);
                }}
                className="flex-1 min-h-[360px] bg-slate-950 border border-slate-800 focus:border-teal-500/70 rounded-xl p-3 font-mono text-xs text-slate-200 outline-none resize-none"
                spellCheck={false}
              />

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-500">
                  Tip: Cấu trúc giữ nguyên ID để liên kết chính xác dữ liệu gốc.
                </span>
                <button
                  onClick={applyJsonTree}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-teal-500/20 transition-colors"
                >
                  ⚡ Áp dụng Cấu trúc JSON
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
