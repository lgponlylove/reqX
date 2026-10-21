import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useRequestStore } from '../stores/request';
import { useFlowStore } from '../stores/flow';
import { importPostmanCollection, exportCollection, exportAllCollections, isFlowContainer } from '../lib/postman-io';
import { importAnyJson, summarizeImport, type AnyImportResult } from '../lib/import-any';
import { buildBackup } from '../lib/backup';
import { saveExportBesideApp, revealExportedFile, saveDocExport } from '../lib/response-file';
import { docsFileName, renderCollectionDocs } from '../lib/api-docs';
import { renderDocsHtml } from '../lib/docs-html';
import { collectDocsExtras } from '../lib/docs-input';
import { uid } from '../lib/variables';
import ContextMenu, { type MenuItem } from './ContextMenu';
import CurlImport from './CurlImport';
import ExtractVarsDialog from './ExtractVarsDialog';
import ScriptEditorModal from './ScriptEditorModal';
import OpenApiImportModal from './OpenApiImportModal';
import HistoryDiffModal from './HistoryDiffModal';
import TreeStructureModal from './TreeStructureModal';
import { buildTreeFilter, UNFILED_KEY, type TreeFilter } from '../lib/tree-filter';
import { useTranslation } from '../stores/language';
import type { ApiRequest, Collection, Dir, Folder, HttpMethod, HistoryItem } from '../types/api';

/** Component đệ quy render folder tree với nested folders */
function FolderNode({
  collectionId,
  folder,
  allFolders,
  requests,
  compact,
  dropTarget,
  setDropTarget,
  onDropZone,
  openMenu,
  renamingFolder,
  setRenamingFolder,
  renamingFolderText,
  setRenamingFolderText,
  renameFolder,
  collapsed,
  onToggleFolder,
  onDragStart,
  onDragEnd,
  renameReqSig,
  filter,
}: {
  collectionId: string;
  folder: Folder;
  allFolders: Folder[];
  requests: Record<string, ApiRequest>;
  compact: boolean;
  dropTarget: string | null;
  setDropTarget: (t: string | null) => void;
  onDropZone: (e: React.DragEvent, colId: string, target: { folderId: string }, zoneId: string) => void;
  openMenu: (e: React.MouseEvent, item: { kind: 'folder' | 'request'; colId: string; folderId?: string; requestId?: string }) => void;
  renamingFolder: string | null;
  setRenamingFolder: (id: string | null) => void;
  renamingFolderText: string;
  setRenamingFolderText: (s: string) => void;
  renameFolder: (colId: string, folderId: string, name: string) => void;
  collapsed: Record<string, boolean>;
  onToggleFolder: (folderId: string) => void;
  onDragStart: (collectionId: string, requestId: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
  renameReqSig: { id: string; n: number } | null;
  /** Bộ lọc cây ở đầu sidebar — node không khớp bị ẩn, node khớp thì mở tạm không ghi vào `collapsed` */
  filter: TreeFilter;
}) {
  const { t } = useTranslation();
  const hasNested = folder.folderIds && folder.folderIds.length > 0;
  if (filter.active && !filter.fldVisible.has(folder.id)) return null;
  // Folder mặc định mở; trạng thái thu gọn lưu chung với collection (localStorage)
  const open = filter.active || !(collapsed[`fld:${folder.id}`] ?? false);
  const toggle = () => onToggleFolder(folder.id);
  const childFolders = folder.folderIds ? folder.folderIds.map(fid => allFolders.find(f => f.id === fid)).filter(Boolean) as Folder[] : [];

  return (
    <div className={`${compact ? 'mt-0.5' : 'mt-1.5'} ml-1 border-l-2 border-slate-700 pl-1.5 ${dropTarget === `${collectionId}:${folder.id}` ? 'bg-emerald-900/20' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDropTarget(`${collectionId}:${folder.id}`); }}
      onDragLeave={() => { if (dropTarget === `${collectionId}:${folder.id}`) setDropTarget(null); }}
      onDrop={(e) => onDropZone(e, collectionId, { folderId: folder.id }, `${collectionId}:${folder.id}`)}
    >
      <div
        className="flex items-center gap-1 rounded hover:bg-slate-800/60 cursor-context-menu"
        title={`${folder.name} — chuột phải / double-click / F2`}
        tabIndex={0}
        onContextMenu={(e) => openMenu(e, { kind: 'folder', colId: collectionId, folderId: folder.id })}
        onDoubleClick={() => { setRenamingFolder(folder.id); setRenamingFolderText(folder.name); }}
        onKeyDown={(e) => {
          if (e.key === 'F2' && renamingFolder !== folder.id) {
            e.preventDefault();
            setRenamingFolder(folder.id);
            setRenamingFolderText(folder.name);
          }
        }}
      >
        {/* Mũi tên mở/thu — luôn hiện với mọi folder, kể cả folder chỉ chứa request */}
        <button
          onClick={toggle}
          className="w-4 h-4 shrink-0 flex items-center justify-center text-slate-500 hover:text-white"
          title={filter.active ? 'Đang lọc: mọi mục khớp đều mở tạm' : open ? 'Thu gọn folder' : 'Mở rộng folder'}
        >
          {open ? '▾' : '▸'}
        </button>
        
        {renamingFolder === folder.id ? (
          <input
            autoFocus
            className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs"
            value={renamingFolderText}
            onChange={(e) => setRenamingFolderText(e.target.value)}
            onBlur={() => {
              if (renamingFolderText.trim()) renameFolder(collectionId, folder.id, renamingFolderText.trim());
              setRenamingFolder(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renamingFolderText.trim()) {
                renameFolder(collectionId, folder.id, renamingFolderText.trim());
                setRenamingFolder(null);
              }
              if (e.key === 'Escape') setRenamingFolder(null);
            }}
          />
        ) : (
          <span
            onClick={toggle}
            className="flex-1 truncate text-xs font-semibold text-slate-300 cursor-pointer"
            title={folder.name}
          >
            📁 {folder.name}
            {(folder.preRequest ?? '').trim() || (folder.tests ?? '').trim() ? ' 📜' : ''}{' '}
            <span className="text-slate-500">({folder.requestIds.length}{hasNested ? ` +${childFolders.length}📂` : ''})</span>
          </span>
        )}
      </div>
      
      {/* Thu gọn → chỉ giữ 1 dòng tiêu đề */}
      {open && (
        <>
          {/* Render requests trong folder này */}
          {folder.requestIds.map((id) => {
            const r = requests[id];
            if (!r) return null;
            if (filter.active && !filter.reqVisible.has(id)) return null;
            return <ReqRow key={id} collectionId={collectionId} req={r} compact={compact} onDragStart={onDragStart} onDragEnd={onDragEnd} onMenu={(e, colId, requestId) => openMenu(e, { kind: 'request', colId, requestId })} renameSignal={renameReqSig?.id === id ? renameReqSig.n : 0} />;
          })}
          {folder.requestIds.length === 0 && !hasNested && (
            <p className="text-[11px] text-slate-600 italic px-2 py-0.5">{t.sidebar.dragRequestHere}</p>
          )}

          {/* Render nested folders */}
          {childFolders.map(child => (
            <FolderNode
              key={child.id}
              collectionId={collectionId}
              folder={child}
              allFolders={allFolders}
              requests={requests}
              compact={compact}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onDropZone={onDropZone}
              openMenu={openMenu}
              renamingFolder={renamingFolder}
              setRenamingFolder={setRenamingFolder}
              renamingFolderText={renamingFolderText}
              setRenamingFolderText={setRenamingFolderText}
              renameFolder={renameFolder}
              collapsed={collapsed}
              onToggleFolder={onToggleFolder}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              renameReqSig={renameReqSig}
              filter={filter}
            />
          ))}
        </>
      )}
    </div>
  );
}

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-400',
  PATCH: 'text-purple-400',
  DELETE: 'text-red-400',
  HEAD: 'text-slate-400',
  OPTIONS: 'text-slate-400',
};

function ReqRow({
  collectionId,
  req,
  onDragStart,
  onMenu,
  renameSignal,
  compact,
  onDragEnd,
}: {
  collectionId: string;
  req: ApiRequest;
  onDragStart: (collectionId: string, requestId: string, e: React.DragEvent) => void;
  onMenu: (e: React.MouseEvent, collectionId: string, requestId: string) => void;
  /** Đổi mỗi lần menu "Đổi tên" được bấm cho request này */
  renameSignal: number;
  /** Chế độ gọn: hàng thấp hơn để hiện được nhiều */
  compact: boolean;
  /** Kết thúc kéo (thả ngoài/kéo hủy) → xóa highlight vùng thả */
  onDragEnd: () => void;
}) {
  const { load } = useRequestStore();
  const { renameRequest } = useAppStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const startEdit = () => {
    setText(req.name);
    setEditing(true);
  };

  useEffect(() => {
    if (renameSignal > 0) {
      setText(req.name);
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameSignal]);

  const commit = () => {
    if (text.trim()) renameRequest(req.id, text.trim());
    setEditing(false);
  };

  return (
    <div
      className="group flex items-center rounded hover:bg-slate-800 cursor-context-menu select-none"
      title={`${req.method} ${req.name || '(không tên)'} — kéo vào collection/folder khác để di chuyển • chuột phải / double-click / F2`}
      tabIndex={0}
      draggable={!editing}
      onDragStart={(e) => {
        if (editing) {
          e.preventDefault();
          return;
        }
        onDragStart(collectionId, req.id, e);
      }}
      onDragEnd={onDragEnd}
      onContextMenu={(e) => onMenu(e, collectionId, req.id)}
      onDoubleClick={startEdit}
      onKeyDown={(e) => {
        if (e.key === 'F2') {
          e.preventDefault();
          startEdit();
        }
      }}
    >
      {editing ? (
        <input
          autoFocus
          className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 mx-1 my-0.5 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button
          onClick={() => load(req)}
          className={`flex-1 min-w-0 flex items-baseline gap-1.5 text-left font-mono text-xs whitespace-nowrap ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'}`}
        >
          <span className={`font-bold inline-block w-14 shrink-0 ${METHOD_COLOR[req.method]}`}>{req.method}</span>
          <span className={`truncate min-w-0 ${req.name ? '' : 'text-slate-500 italic'}`}>{req.name || '(không tên)'}</span>
        </button>
      )}
    </div>
  );
}

export default function Sidebar({ onCollapse, onGoFlow }: { onCollapse: () => void; onGoFlow?: () => void }) {
  const {
    collections, dirs, requests, history,
    environments, activeEnvId, globals,
    addCollection, renameCollection, deleteCollection, removeRequestFromCollection,
    duplicateRequest,
    addDir, renameDir, deleteDir, moveCollection, moveDir,
    addFolder, renameFolder, deleteFolder, moveRequest, moveRequestToCollection,
    setCollectionScripts, setFolderScripts,
    saveRequest,
    removeHistoryItem, clearHistory, importData,
  } = useAppStore();
  const { t } = useTranslation();
  const { current, load, markClean, set } = useRequestStore();
  const { flows, requestFlowRun } = useFlowStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingText, setRenamingText] = useState('');
  const [addingFolderFor, setAddingFolderFor] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingFolderText, setRenamingFolderText] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [hisQuery, setHisQuery] = useState('');
  const [hisStatusFilter, setHisStatusFilter] = useState<'all' | '2xx' | '4xx' | '5xx'>('all');
  const [hisTimeFilter, setHisTimeFilter] = useState<'all' | '1h' | 'today'>('all');
  const [selectedForDiff, setSelectedForDiff] = useState<string[]>([]);
  const [diffModalItems, setDiffModalItems] = useState<[HistoryItem, HistoryItem] | null>(null);
  /** Lọc cây collection: khớp tên request + URL + method + tên collection/folder (cùng breadth với Ctrl+K) */
  const [treeQuery, setTreeQuery] = useState('');
  const treeRef = useRef<HTMLInputElement>(null);
  const filter = useMemo(() => buildTreeFilter(collections, requests, dirs, treeQuery), [collections, requests, dirs, treeQuery]);
  const [showCurl, setShowCurl] = useState(false);
  const [showOpenApi, setShowOpenApi] = useState(false);
  /** Tab sidebar: collections hoặc lịch sử (lịch sử ẩn đi cho gọn) */
  const [sideTab, setSideTab] = useState<'col' | 'his'>('col');
  const [pendingImport, setPendingImport] = useState<{ collection: Collection; reqs: ApiRequest[] } | null>(null);
  const [pendingDir, setPendingDir] = useState('');
  /** Đang mở hộp sửa script ở mức collection hoặc folder. */
  const [scriptEdit, setScriptEdit] = useState<{ colId: string; folderId?: string } | null>(null);
  /** Hộp trích biến môi trường từ request, mở qua menu chuột phải collection/folder */
  const [extract, setExtract] = useState<{ colId: string; folderId?: string } | null>(null);
  /** null = không nhập; {parentId} = đang nhập tên thư mục mới (parentId null = gốc) */
  const [addingDir, setAddingDir] = useState<{ parentId: string | null } | null>(null);
  const [dirName, setDirName] = useState('');
  const [dirRenaming, setDirRenaming] = useState<{ id: string; text: string } | null>(null);
  /** id thư mục đang thu gọn (persist localStorage) */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('postman-clone-collapsed-dirs') ?? '{}');
    } catch {
      return {};
    }
  });

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem('postman-clone-collapsed-dirs', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  };
  /** Chế độ gọn: card thấp hơn để hiện được nhiều collection (persist localStorage) */
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem('reqx-side-compact') !== '0';
    } catch {
      return true;
    }
  });
  const toggleCompact = () => {
    setCompact((v) => {
      try {
        localStorage.setItem('reqx-side-compact', v ? '0' : '1');
      } catch { /* ignore */ }
      return !v;
    });
  };
  /** Mở/thu hết collections + folder bên trong cùng lúc */
  const setAllCols = (open: boolean) => {
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const c of collections) {
        next[`col:${c.id}`] = !open;
        for (const f of c.folders) next[`fld:${f.id}`] = !open;
      }
      try {
        localStorage.setItem('postman-clone-collapsed-dirs', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  };
  const [menu, setMenu] = useState<{
    x: number; y: number; kind: 'collection' | 'folder' | 'request' | 'dir';
    colId: string; folderId?: string; requestId?: string; dirId?: string;
  } | null>(null);
  /** Mở collection (ghi đè trạng thái thu gọn) — dùng sau khi thả/chuyển request vào để thấy kết quả */
  const setColOpen = (colId: string, open: boolean) => {
    setCollapsed((prev) => {
      const next = { ...prev, [`col:${colId}`]: !open };
      try {
        localStorage.setItem('postman-clone-collapsed-dirs', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  };
  /** Bung một folder ra — dùng sau khi thả request vào folder đang thu gọn */
  const setFldOpen = (folderId: string, open: boolean) => {
    setCollapsed((prev) => {
      const next = { ...prev, [`fld:${folderId}`]: !open };
      try {
        localStorage.setItem('postman-clone-collapsed-dirs', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  };
  /** Tạo folder từ ô nhập ở sidebar. Phải mở collection ra — nếu không thì khi ô nhập biến mất,
   *  collection cụp lại và folder vừa tạo bị ẩn, trông như "tạo không được". */
  const commitNewFolder = (colId: string) => {
    const name = folderName.trim();
    if (name) {
      addFolder(colId, name);
      setColOpen(colId, true);
    }
    setFolderName('');
    setAddingFolderFor(null);
  };
  /** Đặt trạng thái mở/thu cho một thư mục (dir) trong cây. */
  const setDirOpen = (dirId: string, open: boolean) => {
    setCollapsed((prev) => {
      const next = { ...prev, [dirId]: !open };
      try {
        localStorage.setItem('postman-clone-collapsed-dirs', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  };
  /** Chọn đích khi dùng menu "Chuyển sang collection…" (không cần kéo-thả) */
  const [movePick, setMovePick] = useState<{ requestId: string; fromId: string; x: number; y: number } | null>(null);
  /** {id request cần rename, số thứ tự} — ReqRow đúng id sẽ mở ô sửa tên */
  const [renameReqSig, setRenameReqSig] = useState<{ id: string; n: number } | null>(null);
  /** Modal quản lý cấu trúc cây & JSON tree */
  const [showTreeModal, setShowTreeModal] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const postmanFileRef = useRef<HTMLInputElement>(null);

  /**
   * Import file: nhận diện từng loại (backup full / ReqX gộp / flow lẻ / Postman).
   * 1 collection Postman duy nhất → cho chọn thư mục; còn lại nhập thẳng + báo tổng.
   */
  async function onImportFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 1) {
      try {
        const json = JSON.parse(await list[0].text());
        const raws = Array.isArray(json) ? json : [json];
        const raw = raws[0];
        const special =
          (json && typeof json === 'object' && !Array.isArray(json) && (json as { kind?: unknown }).kind === 'reqx-backup') ||
          (raw && typeof raw === 'object' &&
            ((raw as { kind?: unknown }).kind === 'reqx-flow' || Array.isArray((raw as { steps?: unknown }).steps)));
        if (raws.length === 1 && !special) {
          const { collection, requests: reqs } = importPostmanCollection(raw);
          setPendingDir('');
          setPendingImport({ collection, reqs });
          return;
        }
      } catch {
        // Parse lỗi → để helper bên dưới báo lỗi.
      }
    }
    // Nhiều file hoặc backup/flow → import thẳng + báo tổng
    const agg: AnyImportResult = { collections: [], flows: [], info: [], warnings: [], errors: [] };
    for (const file of list) {
      try {
        const r = importAnyJson(JSON.parse(await file.text()), file.name);
        agg.collections.push(...r.collections);
        agg.flows.push(...r.flows);
        agg.info.push(...r.info);
        agg.warnings.push(...r.warnings);
        agg.errors.push(...r.errors);
      } catch (e) {
        agg.errors.push(`${file.name}: ${e instanceof Error ? e.message : 'file lỗi'}`);
      }
    }
    setPendingImport(null);
    setPendingDir('');
    alert(summarizeImport(agg));
    if (agg.flows.length > 0) onGoFlow?.();
  }

  function confirmImport() {
    if (!pendingImport) return;
    importData(pendingImport.collection, pendingImport.reqs);
    if (pendingDir) moveCollection(pendingImport.collection.id, pendingDir);
    setPendingImport(null);
    setPendingDir('');
  }

  function onDragStart(collectionId: string, requestId: string, e: React.DragEvent) {
    e.dataTransfer.setData('application/x-postman-req', JSON.stringify({ collectionId, requestId }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDropZone(
    e: React.DragEvent,
    collectionId: string,
    target: { folderId: string } | 'root',
    key: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/x-postman-req'));
      if (!data.requestId || !data.collectionId) return;
      if (data.collectionId === collectionId) {
        moveRequest(collectionId, data.requestId, target);
      } else {
        // Thả sang collection khác (cùng/khác thư mục)
        moveRequestToCollection(data.collectionId, data.requestId, collectionId, target);
      }
      // Bung collection + folder đích ra để thấy request vừa chuyển tới
      setColOpen(collectionId, true);
      if (target !== 'root') setFldOpen(target.folderId, true);
    } catch {
      /* kéo thả ngoài app — bỏ qua */
    }
  }

  const dropCls = (key: string) =>
    dropTarget === key ? 'bg-emerald-900/40 outline outline-1 outline-emerald-600 rounded' : '';

  /** Chuột phải vào collection/folder/request/thư mục → mở menu chức năng. */
  const openMenu = (
    e: React.MouseEvent,
    target: { kind: 'collection' | 'folder' | 'request' | 'dir'; colId: string; folderId?: string; requestId?: string; dirId?: string },
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, ...target });
  };

  /** Kéo collection sang thư mục khác (grip ⋮⋮ ở tên collection). */
  function onDragStartCol(e: React.DragEvent, collectionId: string) {
    e.dataTransfer.setData('application/x-postman-col', JSON.stringify({ collectionId }));
    e.dataTransfer.effectAllowed = 'move';
  }

  /** Kéo thư mục sang thư mục khác (grip ⋮⋮ ở tiêu đề thư mục). */
  function onDragStartDir(e: React.DragEvent, dirId: string) {
    e.dataTransfer.setData('application/x-postman-dir', JSON.stringify({ dirId }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDropCol(e: React.DragEvent, dirId: string | null, key: string) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    // 0. Thả thư mục → chuyển vào thư mục khác (store tự chặn vòng lặp)
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/x-postman-dir'));
      if (data.dirId && data.dirId !== dirId) {
        moveDir(data.dirId, dirId);
        return;
      }
      if (data.dirId) return;
    } catch {
      /* không phải dir — thử tiếp */
    }
    // 1. Thả collection → chuyển thư mục
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/x-postman-col'));
      if (data.collectionId) {
        moveCollection(data.collectionId, dirId);
        return;
      }
    } catch {
      /* không phải collection — thử request */
    }
    // 2. Thả request vào tiêu đề thư mục → collection đầu tiên trong thư mục
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/x-postman-req'));
      if (!data.requestId || !data.collectionId) return;
      const firstCol =
        dirId == null
          ? unfiled[0]
          : collections.find((c) => c.id === dirs.find((d) => d.id === dirId)?.collectionIds[0]);
      if (!firstCol || firstCol.id === data.collectionId) return;
      moveRequestToCollection(data.collectionId, data.requestId, firstCol.id, 'root');
      setColOpen(firstCol.id, true);
    } catch {
      /* kéo thả ngoài app — bỏ qua */
    }
    void key;
  }

  function exportCol(c: Collection) {
    void (async () => {
      try {
        const where = await downloadJson(`${c.name}.postman.json`, exportCollection(c, Object.values(requests)));
        alert(`Đã xuất collection "${c.name}" → ${where}`);
      } catch (e) {
        alert(`Xuất thất bại: ${e instanceof Error ? e.message : e}`);
      }
    })();
  }

  function exportGitCol(c: Collection) {
    void (async () => {
      try {
        const { downloadGitCollectionZip } = await import('../lib/git-collection');
        const reqIds = new Set<string>(c.rootRequestIds);
        for (const f of c.folders) {
          for (const id of f.requestIds) reqIds.add(id);
        }
        const colReqs = Object.values(requests).filter((r) => reqIds.has(r.id));
        await downloadGitCollectionZip(c, colReqs);
      } catch (e) {
        alert(`Xuất Git Collection thất bại: ${e instanceof Error ? e.message : e}`);
      }
    })();
  }

  /** Xuất TẤT CẢ collections thật (bỏ qua vỏ "(flow)" sinh ra từ import flow — muốn giữ flow thì dùng Backup full). */
  function exportAll() {
    void (async () => {
      try {
        const cols = collections.filter((c) => !isFlowContainer(c));
        const skipped = collections.length - cols.length;
        if (cols.length === 0) {
          alert(
            skipped > 0
              ? 'Toàn bộ collections hiện có đều là vỏ của flow — không có collection thật để xuất.\nMuốn giữ flow thì dùng 💾 Backup full.'
              : 'Chưa có collection nào để xuất.',
          );
          return;
        }
        const reqCount = cols.reduce(
          (n, c) => n + c.folders.reduce((m, f) => m + f.requestIds.length, 0) + c.rootRequestIds.length,
          0,
        );
        const where = await downloadJson('reqx-collections.json', exportAllCollections(cols, Object.values(requests)));
        alert(
          `Đã xuất ${cols.length} collection (${reqCount} requests) → ${where}` +
            (skipped > 0 ? `\nBỏ qua ${skipped} vỏ "(flow)" — muốn giữ flow thì dùng 💾 Backup full.` : ''),
        );
      } catch (e) {
        alert(`Xuất thất bại: ${e instanceof Error ? e.message : e}`);
      }
    })();
  }

  function exportToGitWorkspace() {
    void (async () => {
      try {
        const { saveWorkspaceFile, revealExportedFile } = await import('../lib/response-file');
        const { exportCollectionToGitFiles } = await import('../lib/git-collection');
        const cols = collections.filter((c) => !isFlowContainer(c));
        if (cols.length === 0) {
          alert('Không có collection nào để xuất.');
          return;
        }
        
        let lastPath = '';
        let successCount = 0;
        
        for (const c of cols) {
          const reqIds = new Set<string>(c.rootRequestIds);
          for (const f of c.folders) {
            for (const id of f.requestIds) reqIds.add(id);
          }
          const colReqs = Object.values(requests).filter((r) => reqIds.has(r.id));
          
          const gitFiles = exportCollectionToGitFiles(c, colReqs);
          const safeCol = c.name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
          for (const gf of gitFiles) {
            const cleanRelPath = gf.path.replace(/^\/+/, '');
            const saved = await saveWorkspaceFile(`${safeCol}/${cleanRelPath}`, gf.content);
            if (saved) lastPath = saved.path;
          }
          successCount++;
        }
        
        if (successCount > 0 && lastPath) {
          await revealExportedFile(lastPath);
          alert(`Đã xuất thành công ${successCount} collections dưới dạng Plain-text YAML Git-friendly vào thư mục reqx_workspace!`);
        } else {
          alert('Tính năng này chỉ hoạt động trên ứng dụng Desktop (Tauri).');
        }
      } catch (e) {
        alert(`Xuất Workspace thất bại: ${e instanceof Error ? e.message : e}`);
      }
    })();
  }

  function importFromGitWorkspace() {
    void (async () => {
      try {
        const { readWorkspaceFiles } = await import('../lib/response-file');
        const files = await readWorkspaceFiles();
        if (files.length === 0) {
          alert('Không tìm thấy file nào trong thư mục reqx_workspace, hoặc tính năng này không chạy được trên Web.');
          return;
        }
        
        let successCols = 0;
        let successReqs = 0;
        
        for (const content of files) {
          try {
            const data = JSON.parse(content);
            const { importAnyJson } = await import('../lib/import-any');
            const res = importAnyJson(data, 'Workspace File');
            successCols += res.collections.length;
            successReqs += res.collections.reduce((sum, c) => sum + c.requests, 0);
          } catch (err) {
            console.error('Lỗi parse JSON workspace:', err);
          }
        }
        
        if (successCols > 0) {
          alert(`Đã ĐỒNG BỘ thành công từ thư mục reqx_workspace!\nCập nhật: ${successCols} Collections, ${successReqs} Requests.`);
        } else {
          alert('Không có collection hợp lệ nào được tìm thấy trong thư mục.');
        }
      } catch (e) {
        alert(`Import Workspace thất bại: ${e instanceof Error ? e.message : e}`);
      }
    })();
  }

  /** Xuất BACKUP full: collections + flows trong 1 file duy nhất, nhập lại chạy tiếp được ngay. */
  function exportBackup() {
    void (async () => {
      try {
        if (collections.length === 0 && flows.length === 0) {
          alert('Chưa có gì để backup.');
          return;
        }
        const where = await downloadJson(
          'reqx-backup.json',
          buildBackup(dirs, collections, Object.values(requests), flows),
        );
        alert(`Đã backup ${collections.length} collection + ${flows.length} flow → ${where}\nNhập lại file này là chạy tiếp được ngay.`);
      } catch (e) {
        alert(`Backup thất bại: ${e instanceof Error ? e.message : e}`);
      }
    })();
  }

  /**
   * Lưu file export: trong app .exe thì ghi ngay cạnh app + mở thư mục bôi đen file,
   * trả về đường dẫn để hiện cho user; trên web thì tải về Downloads như cũ.
   */
  async function downloadJson(filename: string, text: string): Promise<string> {
    const saved = await saveExportBesideApp(filename, text);
    if (saved) {
      await revealExportedFile(saved.path);
      return saved.path;
    }
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    // WebView (Tauri) nuốt click trên thẻ <a> rời — phải gắn vào DOM mới tải được
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'thư mục Downloads';
  }

  /** true nếu id là con/cháu của ancestorId (đi ngược parentId lên gốc). */
  function isDescDir(ancestorId: string, id: string): boolean {
    let p: string | null | undefined = dirs.find((d) => d.id === id)?.parentId;
    const seen = new Set<string>();
    while (p) {
      if (p === ancestorId) return true;
      if (seen.has(p)) return false;
      seen.add(p);
      p = dirs.find((d) => d.id === p)?.parentId;
    }
    return false;
  }

  /** Đường dẫn đầy đủ "Cha / Con / Cháu" để hiện trong menu/select. */
  function dirPath(id: string): string {
    const parts: string[] = [];
    let cur: string | null | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const d = dirs.find((x) => x.id === cur);
      if (!d) break;
      parts.unshift(d.name);
      cur = d.parentId ?? null;
    }
    return parts.join(' / ');
  }

  /** Đếm đệ quy bên trong 1 thư mục: thư mục con + collections + requests. */
  function countDirDeep(id: string): { subDirs: number; cols: number; reqs: number } {
    const sub = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const d of dirs) {
        if ((d.parentId ?? null) === cur && !sub.has(d.id)) {
          sub.add(d.id);
          stack.push(d.id);
        }
      }
    }
    let cols = 0;
    let reqs = 0;
    for (const did of [id, ...sub]) {
      const d = dirs.find((x) => x.id === did);
      if (!d) continue;
      cols += d.collectionIds.length;
      for (const cid of d.collectionIds) {
        const c = collections.find((x) => x.id === cid);
        if (c) {
          reqs += c.rootRequestIds.length;
          reqs += c.folders.reduce((sum, f) => sum + f.requestIds.length, 0);
        }
      }
    }
    return { subDirs: sub.size, cols, reqs };
  }
  function exportDirData(id: string) {
    const rootDir = dirs.find((d) => d.id === id);
    if (!rootDir) return;
    
    const sub = new Set<string>([id]);
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const d of dirs) {
        if ((d.parentId ?? null) === cur && !sub.has(d.id)) {
          sub.add(d.id);
          stack.push(d.id);
        }
      }
    }
    
    const exportDirs = dirs.filter((d) => sub.has(d.id));
    const colIds = new Set<string>();
    for (const d of exportDirs) {
      for (const cid of d.collectionIds) colIds.add(cid);
    }
    
    const exportCols = collections.filter((c) => colIds.has(c.id));
    const reqIds = new Set<string>();
    for (const c of exportCols) {
      for (const rid of c.rootRequestIds) reqIds.add(rid);
      for (const f of c.folders) {
        for (const rid of f.requestIds) reqIds.add(rid);
      }
    }
    
    const exportReqs = Object.values(requests).filter((r) => reqIds.has(r.id));
    
    void (async () => {
      try {
        const safeName = rootDir.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const json = buildBackup(exportDirs, exportCols, exportReqs, []);
        const where = await downloadJson(`reqx-backup-dir-${safeName}.json`, json);
        alert(`Đã xuất thư mục "${rootDir.name}" (${exportCols.length} collection, ${exportReqs.length} request) → ${where}`);
      } catch (e) {
        alert(`Xuất thư mục thất bại: ${e instanceof Error ? e.message : e}`);
      }
    })();
  }


  /** Danh sách phẳng theo cây (DFS) kèm depth + path, dùng cho select/menu. */
  function flatDirs(): { d: Dir; depth: number; path: string }[] {
    const out: { d: Dir; depth: number; path: string }[] = [];
    const walk = (pid: string | null, depth: number, prefix: string) => {
      for (const d of dirs.filter((x) => (x.parentId ?? null) === pid)) {
        const path = prefix ? `${prefix} / ${d.name}` : d.name;
        out.push({ d, depth, path });
        walk(d.id, depth + 1, path);
      }
    };
    walk(null, 0, '');
    return out;
  }

  /** Items cho menu chuột phải đang mở (thư mục / collection / folder / request). */
  /**
   * Xuất tài liệu (Markdown hoặc HTML) cho đúng phạm vi vừa chuột phải: cả collection, hoặc 1 thư mục
   * (kèm folder con bên trong, không lấy request nằm ngoài folder).
   */
  async function exportDocs(col: Collection, format: 'md' | 'html', folderId?: string) {
    const env = environments.find((e) => e.id === activeEnvId);
    const scope = folderId ? col.folders.find((f) => f.id === folderId) : undefined;
    const extras = collectDocsExtras();
    const md = renderCollectionDocs(col, requests, {
      env: { name: env?.name, variables: env?.variables ?? {}, globals },
      folderId,
      ...extras,
    });
    const label = scope ? `${col.name}-${scope.name}` : col.name;
    const text = format === 'html' ? renderDocsHtml(md, { lang: extras.lang }) : md;
    try {
      const where = await saveDocExport(docsFileName(label, format), text, format);
      alert(`📄 ${t.request.docsSaved}: ${where}`);
    } catch (e) {
      alert(`${t.request.docsFailed}: ` + (e instanceof Error ? e.message : String(e)));
    }
  }

  function menuItems(): MenuItem[] {
    if (!menu) return [];
    // Folder và collection cùng dùng một cặp mục tài liệu (md để commit, html để mở trình duyệt).
    const docsItems = (col: Collection, folderId?: string): MenuItem[] => [
      {
        label: folderId ? t.sidebar.folderDocsMd : t.sidebar.colDocsMd,
        onClick: () => exportDocs(col, 'md', folderId),
      },
      {
        label: folderId ? t.sidebar.folderDocsHtml : t.sidebar.colDocsHtml,
        onClick: () => exportDocs(col, 'html', folderId),
      },
    ];
    if (menu.kind === 'dir' && menu.dirId) {
      const d = dirs.find((x) => x.id === menu.dirId);
      if (!d) return [];
      return [
        {
          label: t.sidebar.newSubFolderHere,
          onClick: () => { setDirName(''); setAddingDir({ parentId: d.id }); },
        },
        {
          label: t.sidebar.newColHere,
          onClick: () => {
            const col: Collection = {
              id: uid('col'),
              name: `Collection ${collections.length + 1}`,
              folders: [],
              rootRequestIds: [],
            };
            importData(col, []);
            moveCollection(col.id, d.id);
            setRenamingId(col.id);
            setRenamingText(col.name);
          },
        },
        { label: t.sidebar.renameDir, onClick: () => setDirRenaming({ id: d.id, text: d.name }) },
        ...dirs
          .filter((t) => t.id !== d.id && (t.parentId ?? null) !== d.id && !isDescDir(d.id, t.id))
          .filter((t) => (d.parentId ?? null) !== t.id)
          .slice(0, 20)
          .map((dirItem) => ({
            label: `→ 📁 ${dirPath(dirItem.id)}`,
            onClick: () => moveDir(d.id, dirItem.id),
          })),
        ...((d.parentId ?? null) !== null
          ? [{ label: t.sidebar.moveToRoot, onClick: () => moveDir(d.id, null) } as MenuItem]
          : []),
        {
          label: t.sidebar.exportDirData,
          onClick: () => exportDirData(d.id),
        },
        {
          label: t.sidebar.deleteDirWithContents, danger: true,
          onClick: () => {
            const st = countDirDeep(d.id);
            if (confirm(t.sidebar.deleteDirConfirm.replace('{name}', d.name).replace('{subDirs}', String(st.subDirs)).replace('{cols}', String(st.cols)).replace('{reqs}', String(st.reqs)))) {
              deleteDir(d.id);
            }
          },
        },
      ];
    }
    const c = collections.find((x) => x.id === menu.colId);
    if (!c) return [];
    if (menu.kind === 'request' && menu.requestId) {
      const r = requests[menu.requestId];
      if (!r) return [];
      // Tìm folder hiện tại của request này (nếu có)
      const currentFolder = c.folders.find((f) => f.requestIds.includes(r.id));
      return [
        { label: t.sidebar.openRequest, onClick: () => load(r) },
        { label: t.sidebar.duplicateRequest, onClick: () => duplicateRequest(c.id, r.id) },
        {
          label: t.sidebar.moveToCollection,
          onClick: () => setMovePick({ requestId: r.id, fromId: c.id, x: menu.x, y: menu.y }),
        },
        // Submenu: Move to folder trong cùng collection
        ...c.folders
          .filter((f) => f.id !== currentFolder?.id) // bỏ folder hiện tại
          .slice(0, 20)
          .map((f) => ({
            label: `→ 📁 ${f.name}`,
            onClick: () => moveRequest(c.id, r.id, { folderId: f.id }),
          })),
        ...(currentFolder
          ? [{ label: t.sidebar.moveToRoot, onClick: () => moveRequest(c.id, r.id, 'root') } as MenuItem]
          : []),
        {
          label: t.sidebar.renameRequest,
          onClick: () => setRenameReqSig((s) => ({ id: r.id, n: (s?.n ?? 0) + 1 })),
        },
        {
          label: t.sidebar.addRequestHere,
          onClick: () => {
            const nr: ApiRequest = {
              id: uid('req'),
              name: 'New Request',
              method: 'GET',
              url: '',
              params: [],
              headers: [],
              bodyType: 'none',
              body: '',
              auth: { type: 'none' },
              updatedAt: Date.now(),
            };
            saveRequest(nr, c.id);
            // Lấy folder chứa request hiện tại nếu có
            const f = c.folders.find((ff) => ff.requestIds.includes(r.id));
            if (f) {
              moveRequestToCollection(c.id, nr.id, c.id, { folderId: f.id });
            }
            load(nr);
          },
        },
        {
          label: t.sidebar.deleteRequest, danger: true,
          onClick: () => {
            if (confirm(t.sidebar.deleteRequestConfirm.replace('{name}', r.name || r.url))) {
              removeRequestFromCollection(c.id, r.id);
            }
          },
        },
      ];
    }
    if (menu.kind === 'folder' && menu.folderId) {
      const f = c.folders.find((x) => x.id === menu.folderId);
      if (!f) return [];
      return [
        { label: t.sidebar.renameFolder, onClick: () => { setRenamingFolder(f.id); setRenamingFolderText(f.name); } },
        {
          label: (f.preRequest ?? '').trim() || (f.tests ?? '').trim() ? t.sidebar.scriptFolderHas : t.sidebar.scriptFolder,
          onClick: () => setScriptEdit({ colId: c.id, folderId: f.id }),
        },
        {
          label: t.sidebar.extractVars,
          onClick: () => setExtract({ colId: c.id, folderId: f.id }),
        },
        ...docsItems(c, f.id),
        {
          label: t.sidebar.addSubFolder,
          onClick: () => {
            addFolder(c.id, 'New Folder', f.id);
            setColOpen(c.id, true);
            setFldOpen(f.id, true);
          },
        },
        {
          label: t.sidebar.deleteFolder, danger: true,
          onClick: () => {
            if (confirm(t.sidebar.deleteFolderConfirm.replace('{name}', f.name))) {
              deleteFolder(c.id, f.id);
            }
          },
        },
      ];
    }
    const curDir = dirs.find((d) => d.collectionIds.includes(c.id));
    const usingFlows = flows.filter((f) => f.steps.some((st) => st.collectionId === c.id));
    return [
      ...usingFlows.map((f) => ({
        label: t.sidebar.runFlowNamed.replace('{name}', f.name),
        onClick: () => {
          requestFlowRun(f.id);
          onGoFlow?.();
        },
      } as MenuItem)),
      { label: t.sidebar.saveCurrentReqHere, onClick: () => { const saved = current.id && requests[current.id] ? saveRequest(current) : saveRequest(current, c.id); if (saved) { set({ id: saved.id, origin: undefined }); markClean(); } } },
      { label: t.sidebar.newFolder, onClick: () => { setFolderName(''); setAddingFolderFor(c.id); } },
      { label: t.sidebar.exportColJsonPostman, onClick: () => exportCol(c) },
      { label: t.sidebar.exportGitFriendly, onClick: () => exportGitCol(c) },
      {
        label: t.sidebar.extractVarsCol,
        onClick: () => setExtract({ colId: c.id }),
      },
      ...docsItems(c),
      {
        label:
          (c.preRequest ?? '').trim() || (c.tests ?? '').trim() || (c.teardown ?? '').trim()
            ? t.sidebar.scriptColHas
            : t.sidebar.scriptCol,
        onClick: () => setScriptEdit({ colId: c.id }),
      },
      { label: t.sidebar.renameCollection, onClick: () => { setRenamingId(c.id); setRenamingText(c.name); } },
      {
        label: t.sidebar.deleteCollection, danger: true,
        onClick: () => {
          if (confirm(t.sidebar.deleteColConfirm.replace('{name}', c.name))) {
            deleteCollection(c.id);
          }
        },
      },
      // Danh sách chuyển thư mục để CUỐI vì dài nhất (tới 30 dòng) — để nó ở trên thì
      // mục Đổi tên/Xóa bị đẩy tuốt ra ngoài vùng nhìn thấy của menu.
      ...flatDirs()
        .filter(({ d }) => d.id !== curDir?.id)
        .slice(0, 30)
        .map(({ path, d }) => ({
          label: `→ 📁 ${path}`,
          onClick: () => moveCollection(c.id, d.id),
        })),
      ...(curDir
        ? [{ label: t.sidebar.outsideFolder, onClick: () => moveCollection(c.id, null) } as MenuItem]
        : []),
    ];
  }

  type Block = { t: 'dir'; key: string; dir: Dir | null; depth: number } | { t: 'col'; col: Collection; depth: number };
  const unfiled = collections.filter((c) => !dirs.some((d) => d.collectionIds.includes(c.id)));
  const blocks: Block[] = [];
  const pushDirSubtree = (parentId: string | null, depth: number) => {
    for (const d of dirs.filter((x) => (x.parentId ?? null) === parentId)) {
      blocks.push({ t: 'dir', key: `dir-${d.id}`, dir: d, depth });
      if (!filter.active && collapsed[d.id]) continue;
      for (const cid of d.collectionIds) {
        const col = collections.find((x) => x.id === cid);
        if (col) blocks.push({ t: 'col', col, depth: depth + 1 });
      }
      pushDirSubtree(d.id, depth + 1);
    }
  };
  pushDirSubtree(null, 0);
  if (dirs.length === 0) {
    for (const c of collections) blocks.push({ t: 'col', col: c, depth: 0 });
  } else if (unfiled.length > 0) {
    blocks.push({ t: 'dir', key: 'dir-unfiled', dir: null, depth: 0 });
    if (filter.active || !collapsed['unfiled']) {
      for (const c of unfiled) blocks.push({ t: 'col', col: c, depth: 1 });
    }
  }

  const commitNewDir = () => {
    const name = dirName.trim();
    if (name && addingDir) {
      addDir(name, addingDir.parentId);
      // Mở thư mục cha lên để thư mục con vừa tạo hiện ra ngay, không "biến mất" sau khi nhập
      if (addingDir.parentId) setDirOpen(addingDir.parentId, true);
    }
    setDirName('');
    setAddingDir(null);
  };

  /** Tiêu đề thư mục = nắp hộp bao nhóm collection + thư mục con: rename inline + menu + nhận kéo-thả. */
  const renderDirHeader = (dir: Dir | null, key: string, depth: number) => {
    const dkey = dir?.id ?? 'unfiled';
    const subCount = dir ? dirs.filter((x) => (x.parentId ?? null) === dir.id).length : 0;
    const count = dir ? dir.collectionIds.length : unfiled.length;
    const label = dir ? dir.name : t.sidebar.unfiledDir;
    // Thu gọn hoặc rỗng → bo tròn cả hộp (không có card nào bên dưới)
    const isCollapsed = !filter.active && !!collapsed[dkey];
    const empty = (!!dir && dir.collectionIds.length === 0 && subCount === 0) || isCollapsed;
    const hasTargetCol = dir ? dir.collectionIds.length > 0 : unfiled.length > 0;
    return (
      <div
        key={key}
        style={depth > 0 ? { marginLeft: depth * 12 } : undefined}
        className={`${compact ? 'mt-1' : 'mt-2'} flex items-center gap-1 bg-slate-800/70 border border-slate-700 ${
          empty ? 'rounded-lg' : 'rounded-t-lg border-b-0'
        } ${dropCls(`dir:${dkey}`)} ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1.5'}`}
        title="Thả collection/thư mục vào đây • Thả request → collection đầu tiên trong thư mục • Chuột phải để tạo thư mục con"
        onDragOver={(e) => {
          const t = e.dataTransfer.types;
          const acceptCol = t.includes('application/x-postman-col');
          const acceptDir = !!dir && t.includes('application/x-postman-dir');
          const acceptReq = hasTargetCol && t.includes('application/x-postman-req');
          if (acceptCol || acceptDir || acceptReq) {
            e.preventDefault();
            setDropTarget(`dir:${dkey}`);
          }
        }}
        onDragLeave={() => setDropTarget((t) => (t === `dir:${dkey}` ? null : t))}
        onDrop={(e) => onDropCol(e, dir?.id ?? null, `dir:${dkey}`)}
      >
        <button
          onClick={() => toggleCollapse(dkey)}
          title={isCollapsed ? 'Mở rộng thư mục' : 'Thu gọn thư mục'}
          className="text-slate-400 hover:text-white px-1 text-xs shrink-0"
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        {dir && (
          <span
            draggable
            onDragStart={(e) => onDragStartDir(e, dir.id)}
            title="Kéo để chuyển thư mục sang thư mục khác"
            className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 px-0.5 select-none shrink-0 text-xs"
          >
            ⋮⋮
          </span>
        )}
        {dir && dirRenaming?.id === dir.id ? (
          <input
            autoFocus
            className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs"
            value={dirRenaming.text}
            onChange={(e) => setDirRenaming({ id: dir.id, text: e.target.value })}
            onBlur={() => {
              if (dirRenaming.text.trim()) renameDir(dir.id, dirRenaming.text.trim());
              setDirRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirRenaming.text.trim()) {
                renameDir(dir.id, dirRenaming.text.trim());
                setDirRenaming(null);
              }
              if (e.key === 'Escape') setDirRenaming(null);
            }}
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate text-xs font-bold text-slate-200 cursor-context-menu rounded hover:bg-slate-800/60 px-1"
            title={dir ? `${label} — chuột phải / double-click / F2` : label}
            tabIndex={dir ? 0 : undefined}
            onContextMenu={dir ? (e) => openMenu(e, { kind: 'dir', colId: '', dirId: dir.id }) : undefined}
            onDoubleClick={dir ? () => setDirRenaming({ id: dir.id, text: dir.name }) : undefined}
            onKeyDown={
              dir
                ? (e) => {
                    if (e.key === 'F2' && dirRenaming?.id !== dir.id) {
                      e.preventDefault();
                      setDirRenaming({ id: dir.id, text: dir.name });
                    }
                  }
                : undefined
            }
          >
            📁 {label} <span className="text-slate-500 font-normal">({count}{subCount > 0 ? `, ${subCount} 📁` : ''})</span>
          </span>
        )}
      </div>
    );
  };

  /** Nút ＋ collection: tạo tên mặc định rồi mở rename inline ngay. */
  function quickAddCollection() {
    const before = new Set(collections.map((c) => c.id));
    const name = `Collection ${collections.length + 1}`;
    addCollection(name);
    const created = useAppStore.getState().collections.find((c) => !before.has(c.id));
    if (created) {
      setRenamingId(created.id);
      setRenamingText(created.name);
    }
    setSideTab('col');
  }

  /** Menu của icon 📁 (thao tác collection + chuyển view) */
  const [toolMenu, setToolMenu] = useState<{ x: number; y: number } | null>(null);

  const toolMenuItems: MenuItem[] = [
    { label: t.sidebar.viewCollections, onClick: () => setSideTab('col') },
    { label: t.sidebar.addCollection, onClick: () => quickAddCollection() },
    { label: t.sidebar.addFolder, onClick: () => { setDirName(''); setAddingDir({ parentId: null }); setSideTab('col'); } },
    { label: t.sidebar.importJson, onClick: () => fileRef.current?.click() },
    { label: t.sidebar.importSwagger, onClick: () => setShowOpenApi(true) },
    { label: t.sidebar.importPostman, onClick: () => postmanFileRef.current?.click() },
    { label: t.sidebar.exportAll, onClick: () => exportAll() },
    { label: t.sidebar.exportGit, onClick: () => exportToGitWorkspace() },
    { label: t.sidebar.importGit, onClick: () => importFromGitWorkspace() },
    { label: t.sidebar.backupFull, onClick: () => exportBackup() },
    { label: t.sidebar.importCurl, onClick: () => setShowCurl(true) },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 text-sm">
      <input
        ref={fileRef} type="file" accept=".json" multiple className="hidden"
        onChange={(e) => { if (e.target.files?.length) onImportFiles(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={postmanFileRef} type="file" accept=".json,.zip" multiple className="hidden"
        onChange={async (e) => {
          if (!e.target.files?.length) { e.target.value = ''; return; }
          const files = Array.from(e.target.files);
          const agg: AnyImportResult = { collections: [], flows: [], info: [], warnings: [], errors: [] };
          for (const file of files) {
            try {
              if (file.name.toLowerCase().endsWith('.zip')) {
                const buffer = await file.arrayBuffer();
                const { importCollectionFromZip } = await import('../lib/git-collection');
                const res = await importCollectionFromZip(buffer, file.name.replace(/\.zip$/i, ''));
                if (res.requests.length > 0) {
                  useAppStore.getState().importData(res.collection, res.requests);
                  agg.collections.push({ name: res.collection.name, requests: res.requests.length });
                  agg.info.push(`✓ Đã nạp Git Collection "${res.collection.name}" (${res.requests.length} requests)`);
                  continue;
                }
              }
              const r = importAnyJson(JSON.parse(await file.text()), file.name);
              agg.collections.push(...r.collections);
              agg.flows.push(...r.flows);
              agg.info.push(...r.info);
              agg.warnings.push(...r.warnings);
              agg.errors.push(...r.errors);
            } catch (err) {
              agg.errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          alert(summarizeImport(agg));
          e.target.value = '';
        }}
      />

      {/* PROJECT Section Card (Cyber Glassmorphism Container) */}
      <div className="bg-slate-900/95 dark:bg-[#0b141e]/95 border border-teal-500/40 rounded-2xl p-2.5 shadow-[0_0_25px_rgba(20,184,166,0.22)] backdrop-blur-xl flex flex-col flex-1 min-h-0">
        {/* Header Row matching Cyber style: PROJECT, Count, History, Gear, 3-dots, Collapse */}
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-teal-500/20 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span className="font-extrabold text-xs tracking-wider uppercase font-mono text-cyan-300 drop-shadow-[0_0_6px_rgba(6,182,212,0.5)]">
              {t.sidebar.project}
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-teal-950/80 border border-teal-500/30 text-teal-300 font-mono">
              {collections.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setSideTab((t) => (t === 'col' ? 'his' : 'col'))}
              title={sideTab === 'col' ? `${t.sidebar.viewHistory} (${history.length})` : t.sidebar.viewCollections}
              className="text-[11px] text-slate-400 hover:text-cyan-300 px-1 py-0.5 rounded hover:bg-slate-800/60 transition-colors"
            >
              {sideTab === 'col' ? `🕘 ${history.length}` : '📁'}
            </button>
            <button
              onClick={(e) => setToolMenu({ x: e.clientX, y: e.clientY })}
              title={t.sidebar.workspaceOptions}
              className="text-slate-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-slate-800/60 font-bold text-xs"
            >
              •••
            </button>
            <button
              onClick={onCollapse}
              title={t.header.collapseSidebar}
              className="text-slate-400 hover:text-emerald-400 text-xs px-1 py-0.5 rounded hover:bg-slate-800/60 transition-colors ml-0.5"
            >
              «
            </button>
          </div>
        </div>

        {/* Ô lọc cây (chỉ tab Collections): node không khớp bị ẩn, node cha của kết quả mở tạm —
            không ghi đè lựa chọn thu/mở đã lưu; Esc hoặc ✕ là cây về như cũ */}
        {sideTab === 'col' && (
          <div className="flex items-center gap-1.5 pb-2 mb-1.5 shrink-0 border-b border-teal-500/10">
            <div className="relative flex-1 min-w-0">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 pointer-events-none">🔍</span>
              <input
                ref={treeRef}
                value={treeQuery}
                onChange={(e) => setTreeQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setTreeQuery('');
                    e.currentTarget.blur();
                  }
                }}
                placeholder={t.sidebar.filterPlaceholder}
                title={t.sidebar.filterPlaceholder}
                className="w-full bg-slate-900/80 border border-slate-700 focus:border-teal-500/70 rounded-lg pl-7 pr-7 py-1 text-xs outline-none placeholder:text-slate-600"
              />
              {filter.active && (
                <button
                  onClick={() => {
                    setTreeQuery('');
                    treeRef.current?.focus();
                  }}
                  title={t.sidebar.filterClear}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white px-1 py-0.5 rounded hover:bg-slate-800"
                >
                  ✕
                </button>
              )}
            </div>
            {filter.active && (
              <span
                className="text-[10px] font-mono text-teal-300 shrink-0"
                title={`${filter.shownReqs}/${filter.totalReqs} ${t.sidebar.filterMatches}`}
              >
                {filter.shownReqs}/{filter.totalReqs}
              </span>
            )}
          </div>
        )}

        {/* Scrollable Tree / Content inside PROJECT Card */}
        <div className="overflow-y-auto flex-1 min-h-0 pr-0.5 flex flex-col gap-1.5">

        {pendingImport && (
        <div className="bg-emerald-950/50 border border-emerald-800 rounded p-2 text-xs">
          <p className="mb-1">
            Nhập <b>{pendingImport.collection.name}</b> ({pendingImport.reqs.length} requests) vào:
          </p>
          <div className="flex gap-1">
            <select
              value={pendingDir}
              onChange={(e) => setPendingDir(e.target.value)}
              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-1.5 py-1"
            >
              <option value="">{t.sidebar.unfiledDir}</option>
              {flatDirs().map(({ d, depth, path }) => (
                <option key={d.id} value={d.id}>{`${'— '.repeat(depth)}📁 ${path}`}</option>
              ))}
            </select>
            <button onClick={confirmImport} className="bg-emerald-600 hover:bg-emerald-500 rounded px-2">
              Nhập
            </button>
            <button onClick={() => setPendingImport(null)} className="bg-slate-800 hover:bg-slate-700 rounded px-2">
              Hủy
            </button>
          </div>
        </div>
      )}

      {sideTab === 'col' && (
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-xs text-slate-300">{t.sidebar.collections} ({collections.length})</h3>
          <div className="flex gap-1 text-xs">
            <button
              onClick={() => setShowTreeModal(true)}
              title={t.treeModal.treeButtonTitle}
              className="px-1.5 py-0.5 rounded text-[11px] bg-teal-950/70 border border-teal-500/30 text-teal-300 hover:bg-teal-900/80 hover:text-white transition-colors flex items-center gap-1 font-mono"
            >
              {t.treeModal.treeButton}
            </button>
            <button onClick={() => setAllCols(true)} title={t.sidebar.openAll} className="text-slate-400 hover:text-white px-1 text-[11px]">{t.sidebar.openAll}</button>
            <button onClick={() => setAllCols(false)} title={t.sidebar.closeAll} className="text-slate-400 hover:text-white px-1 text-[11px]">{t.sidebar.closeAll}</button>
            <button
              onClick={toggleCompact}
              title={compact ? t.common.compactActive : t.common.compact}
              className={`rounded px-1.5 py-0.5 text-[11px] ${compact ? 'bg-slate-700 font-bold text-white' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              {compact ? t.common.compactActive : t.common.compact}
            </button>
          </div>
        </div>
        {addingDir && (
          <div className="mb-2">
            <p className="text-[11px] text-slate-400 mb-1">
              {t.sidebar.newDirIn.replace('{target}', addingDir.parentId ? dirPath(addingDir.parentId) : t.sidebar.root)}
            </p>
            <div className="flex gap-1">
            <input
              autoFocus
              className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs"
              placeholder={t.sidebar.newDirPlaceholder}
              value={dirName}
              onChange={(e) => setDirName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewDir();
                if (e.key === 'Escape') setAddingDir(null);
              }}
            />
            <button onClick={commitNewDir} className="bg-slate-700 hover:bg-slate-600 rounded px-2 text-xs">
              OK
            </button>
            <button onClick={() => setAddingDir(null)} className="bg-slate-800 hover:bg-slate-700 rounded px-2 text-xs">
              {t.common.cancel}
            </button>
            </div>
          </div>
        )}
        {collections.length === 0 && <p className="text-slate-500">{t.sidebar.emptyCollections}</p>}
        {filter.active && filter.colVisible.size === 0 && collections.length > 0 && (
          <p className="text-[11px] text-slate-500 italic py-1">
            {t.sidebar.filterEmpty}: <b className="not-italic text-slate-400">{treeQuery.trim()}</b>
          </p>
        )}
        {blocks.map((b, bi) => {
          if (b.t === 'dir') {
            if (filter.active && !filter.dirVisible.has(b.dir?.id ?? UNFILED_KEY)) return null;
            return renderDirHeader(b.dir, b.key, b.depth);
          }
          const c = b.col;
          if (filter.active && !filter.colVisible.has(c.id)) return null;
          const colDepth = b.depth;
          // Collection mặc định thu gọn 1 dòng kiểu Postman (mở khi đang sửa tên/tạo folder)
          const colKey = `col:${c.id}`;
          const colOpen = filter.active || !(collapsed[colKey] ?? true) || renamingId === c.id || addingFolderFor === c.id;
          // Card nằm trong thư mục → bỏ viền riêng, nối liền thành 1 hộp với nắp thư mục
          const bare = dirs.some((d) => d.collectionIds.includes(c.id));
          const isLast = bi === blocks.length - 1 || blocks[bi + 1]?.t === 'dir';
          // Chế độ gọn: đúng 1 dòng/dòng collection kiểu Postman (mũi tên + tên + số request)
          const totalReqs = c.rootRequestIds.length + c.folders.reduce((a, f) => a + f.requestIds.length, 0);

          const isSingleRequest = totalReqs === 1 && c.folders.length === 0 && renamingId !== c.id && addingFolderFor !== c.id;

          if (isSingleRequest) {
            const reqId = c.rootRequestIds[0];
            const r = requests[reqId];
            if (r && (!filter.active || filter.reqVisible.has(reqId))) {
              return (
                <div
                  key={c.id}
                  style={colDepth > 0 ? { marginLeft: colDepth * 12 } : undefined}
                  className={
                    compact
                      ? `border-b border-slate-800/50 ${dropCls(`${c.id}:header`)}`
                      : bare
                        ? `border-x border-slate-700 bg-slate-900/20 px-1 py-0.5 ${isLast ? 'rounded-b-lg border-b mb-2' : 'border-b border-slate-700/50'} ${dropCls(`${c.id}:header`)}`
                        : `border border-slate-800 rounded p-1 mb-2 ${dropCls(`${c.id}:header`)}`
                  }
                  onDragOver={(e) => { e.preventDefault(); setDropTarget(`${c.id}:header`); }}
                  onDragLeave={() => setDropTarget((t) => (t === `${c.id}:header` ? null : t))}
                  onDrop={(e) => onDropZone(e, c.id, 'root', `${c.id}:header`)}
                >
                  <ReqRow
                    collectionId={c.id}
                    req={r}
                    compact={compact}
                    onDragStart={onDragStart}
                    onDragEnd={() => setDropTarget(null)}
                    onMenu={(e, colId, requestId) => openMenu(e, { kind: 'request', colId, requestId })}
                    renameSignal={renameReqSig?.id === reqId ? renameReqSig.n : 0}
                  />
                </div>
              );
            }
          }

          return (
          <div
            key={c.id}
            style={colDepth > 0 ? { marginLeft: colDepth * 12 } : undefined}
            className={
              compact
                ? 'border-b border-slate-800/50'
                : bare
                  ? `border-x border-slate-700 bg-slate-900/20 px-2 py-2 ${isLast ? 'rounded-b-lg border-b mb-2' : 'border-b border-slate-700/50'}`
                  : 'border border-slate-800 rounded p-2 mb-2'
            }
          >
            <div
              className={`group flex items-center gap-1 cursor-context-menu rounded hover:bg-slate-800/60 ${compact ? 'px-0.5' : 'px-1 py-0.5'} ${dropCls(`${c.id}:header`)}`}
              title={`${c.name} — chuột phải / double-click / F2 • kéo request khác thả vào đây để chuyển sang collection này`}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(`${c.id}:header`); }}
              onDragLeave={() => setDropTarget((t) => (t === `${c.id}:header` ? null : t))}
              onDrop={(e) => onDropZone(e, c.id, 'root', `${c.id}:header`)}
              tabIndex={0}
              onContextMenu={(e) => openMenu(e, { kind: 'collection', colId: c.id })}
              onDoubleClick={() => { setRenamingId(c.id); setRenamingText(c.name); }}
              onKeyDown={(e) => {
                if (e.key === 'F2' && renamingId !== c.id) {
                  e.preventDefault();
                  setRenamingId(c.id);
                  setRenamingText(c.name);
                }
              }}
            >
              {renamingId === c.id ? (
                <input
                  autoFocus
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs"
                  value={renamingText}
                  onChange={(e) => setRenamingText(e.target.value)}
                  onBlur={() => {
                    if (renamingText.trim()) renameCollection(c.id, renamingText.trim());
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renamingText.trim()) {
                      renameCollection(c.id, renamingText.trim());
                      setRenamingId(null);
                    }
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <>
                  <button
                    onClick={() => toggleCollapse(`col:${c.id}`)}
                    title={filter.active ? 'Đang lọc: mọi mục khớp đều mở tạm' : colOpen ? 'Thu gọn collection' : 'Mở rộng collection'}
                    className="text-slate-500 hover:text-white text-xs shrink-0 px-0.5"
                  >
                    {colOpen ? '▾' : '▸'}
                  </button>
                  <span
                    draggable
                    onDragStart={(e) => onDragStartCol(e, c.id)}
                    title="Kéo để chuyển collection sang thư mục khác"
                    className={`cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 px-0.5 select-none shrink-0 ${compact ? 'hidden group-hover:inline' : ''}`}
                  >
                    ⋮⋮
                  </span>
                  <b className={`flex-1 min-w-0 truncate ${compact ? 'text-xs font-medium' : ''}`}>
                    {c.name}
                    {(c.preRequest ?? '').trim() || (c.tests ?? '').trim() || (c.teardown ?? '').trim() ? ' 📜' : ''}{' '}
                    <span className="text-slate-500 font-normal">({totalReqs})</span>
                  </b>
                </>
              )}
            </div>

            {colOpen && (
            <>
            {/* Thêm folder — đặt NGAY DƯỚI tiêu đề collection để ô nhập luôn hiện nơi vừa bấm */}
            {addingFolderFor === c.id && (
              <div className="flex gap-1 mt-1 mb-1">
                <input
                  autoFocus
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-xs"
                  placeholder={t.sidebar.newFolderPlaceholder}
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && folderName.trim()) commitNewFolder(c.id);
                    if (e.key === 'Escape') { setFolderName(''); setAddingFolderFor(null); }
                  }}
                />
                <button
                  onClick={() => commitNewFolder(c.id)}
                  className="bg-slate-700 hover:bg-slate-600 rounded px-2 text-xs"
                >
                  OK
                </button>
              </div>
            )}

            {/* Folders — chỉ render folder gốc, folder con do FolderNode đệ quy */}
            {c.folders
              .filter((f) => !c.folders.some((p) => p.folderIds?.includes(f.id)))
              .map((f) => (
              <FolderNode
                key={f.id}
                collectionId={c.id}
                folder={f}
                allFolders={c.folders}
                requests={requests}
                compact={compact}
                dropTarget={dropTarget}
                setDropTarget={setDropTarget}
                onDropZone={onDropZone}
                openMenu={openMenu}
                renamingFolder={renamingFolder}
                setRenamingFolder={setRenamingFolder}
                renamingFolderText={renamingFolderText}
                setRenamingFolderText={setRenamingFolderText}
                renameFolder={renameFolder}
                collapsed={collapsed}
                onToggleFolder={(fid) => toggleCollapse(`fld:${fid}`)}
                onDragStart={onDragStart}
                onDragEnd={() => setDropTarget(null)}
                renameReqSig={renameReqSig}
                filter={filter}
              />
            ))}

            {/* Root requests (dropzone) */}
            <div
              className={`mt-1 ${dropCls(`${c.id}:root`)}`}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(`${c.id}:root`); }}
              onDragLeave={() => setDropTarget((t) => (t === `${c.id}:root` ? null : t))}
              onDrop={(e) => onDropZone(e, c.id, 'root', `${c.id}:root`)}
            >
              {c.rootRequestIds.map((id) => {
                const r = requests[id];
                if (!r) return null;
                if (filter.active && !filter.reqVisible.has(id)) return null;
                return <ReqRow key={id} collectionId={c.id} req={r} compact={compact} onDragStart={onDragStart} onDragEnd={() => setDropTarget(null)} onMenu={(e, colId, requestId) => openMenu(e, { kind: 'request', colId, requestId })} renameSignal={renameReqSig?.id === id ? renameReqSig.n : 0} />;
              })}
            </div>
            </>
            )}
          </div>
          );
        })}
      </div>
      )}

      {sideTab === 'his' && (
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center mb-0.5">
          <h3 className="font-semibold text-xs text-slate-200">{t.sidebar.history} ({history.length})</h3>
          <div className="flex items-center gap-1.5">
            {selectedForDiff.length === 2 && (
              <button
                type="button"
                onClick={() => {
                  const itemA = history.find((h) => h.id === selectedForDiff[0]);
                  const itemB = history.find((h) => h.id === selectedForDiff[1]);
                  if (itemA && itemB) {
                    setDiffModalItems([itemA, itemB]);
                  }
                }}
                className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold shadow flex items-center gap-1 transition-all animate-pulse"
                title={t.sidebar.diffCompareTooltip}
              >
                <span>⚖️</span>
                <span>{t.sidebar.diffCompare}</span>
              </button>
            )}
            {selectedForDiff.length > 0 && selectedForDiff.length !== 2 && (
              <span className="text-[10px] text-amber-400 font-mono">
                {t.sidebar.diffCompareSelectMore.replace('{count}', String(2 - selectedForDiff.length))}
              </span>
            )}
            {history.length > 0 && (
              <button onClick={clearHistory} className="text-[11px] text-slate-400 hover:text-red-300">
                {t.sidebar.clearAllHistory}
              </button>
            )}
          </div>
        </div>

        {/* Search Input */}
        {history.length > 0 && (
          <div className="relative">
            <input
              className="w-full bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              placeholder={t.sidebar.searchHistoryPlaceholder}
              value={hisQuery}
              onChange={(e) => setHisQuery(e.target.value)}
            />
            {hisQuery && (
              <button
                onClick={() => setHisQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Status Filter Pills */}
        {history.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] flex-wrap">
            <span className="text-slate-500 mr-0.5">Status:</span>
            {(['all', '2xx', '4xx', '5xx'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setHisStatusFilter(st)}
                className={`px-1.5 py-0.5 rounded font-mono transition-colors ${
                  hisStatusFilter === st
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {st.toUpperCase()}
              </button>
            ))}

            <span className="text-slate-500 ml-1.5 mr-0.5">{t.response.time}:</span>
            {(
              [
                ['all', t.sidebar.timeFilterAll],
                ['1h', t.sidebar.timeFilter1h],
                ['today', t.sidebar.timeFilterToday],
              ] as const
            ).map(([tKey, tLabel]) => (
              <button
                key={tKey}
                type="button"
                onClick={() => setHisTimeFilter(tKey)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  hisTimeFilter === tKey
                    ? 'bg-slate-700 text-white font-semibold'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {tLabel}
              </button>
            ))}
          </div>
        )}

        {/* History Item List */}
        <div className="flex flex-col gap-1 max-h-[calc(100vh-280px)] overflow-y-auto pr-0.5">
          {history
            .filter((h) => {
              // 1. Text Query Filter
              const q = hisQuery.trim().toLowerCase();
              if (q) {
                const matchQuery =
                  h.request.method.toLowerCase().includes(q) ||
                  h.request.url.toLowerCase().includes(q) ||
                  String(h.responseStatus).includes(q);
                if (!matchQuery) return false;
              }

              // 2. Status Filter
              if (hisStatusFilter === '2xx' && (h.responseStatus < 200 || h.responseStatus >= 300)) return false;
              if (hisStatusFilter === '4xx' && (h.responseStatus < 400 || h.responseStatus >= 500)) return false;
              if (hisStatusFilter === '5xx' && (h.responseStatus < 500 || h.responseStatus >= 600)) return false;

              // 3. Time Filter
              const now = Date.now();
              if (hisTimeFilter === '1h' && now - h.createdAt > 3600 * 1000) return false;
              if (hisTimeFilter === 'today') {
                const startOfToday = new Date().setHours(0, 0, 0, 0);
                if (h.createdAt < startOfToday) return false;
              }

              return true;
            })
            .slice(0, 50)
            .map((h) => {
              const isChecked = selectedForDiff.includes(h.id);
              const statusColor =
                h.responseStatus >= 200 && h.responseStatus < 300
                  ? 'text-emerald-400'
                  : h.responseStatus >= 300 && h.responseStatus < 400
                  ? 'text-sky-400'
                  : h.responseStatus >= 400 && h.responseStatus < 500
                  ? 'text-amber-400'
                  : 'text-rose-400';

              return (
                <div
                  key={h.id}
                  className={`group flex items-center gap-1.5 rounded p-1 transition-colors ${
                    isChecked ? 'bg-emerald-950/40 border border-emerald-800/60' : 'hover:bg-slate-800/80 border border-transparent'
                  }`}
                >
                  {/* Diff Checkbox */}
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedForDiff((prev) =>
                          prev.length >= 2 ? [prev[1], h.id] : [...prev, h.id]
                        );
                      } else {
                        setSelectedForDiff((prev) => prev.filter((id) => id !== h.id));
                      }
                    }}
                    title="Chọn để so sánh Diff"
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer h-3.5 w-3.5"
                  />

                  <button
                    onClick={() => load(h.request)}
                    className="flex-1 min-w-0 text-left font-mono text-xs text-slate-300 truncate"
                    title={`${h.request.method} ${h.request.url}\nStatus: ${h.responseStatus}\nTime: ${new Date(h.createdAt).toLocaleTimeString()}`}
                  >
                    <span className={`font-bold mr-1 ${statusColor}`}>{h.responseStatus}</span>
                    <span className="font-bold text-slate-400 mr-1">{h.request.method}</span>
                    <span className="truncate">{h.request.url}</span>
                  </button>

                  <span className="text-[10px] text-slate-500 font-mono shrink-0">
                    {h.timeMs}ms
                  </span>

                  <button
                    title="Xóa dòng này"
                    onClick={() => {
                      removeHistoryItem(h.id);
                      setSelectedForDiff((prev) => prev.filter((id) => id !== h.id));
                    }}
                    className="px-1 text-slate-600 group-hover:text-slate-400 hover:!text-red-300 text-xs shrink-0"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
        </div>
      </div>
      )}
        </div>
      </div>

      {diffModalItems && (
        <HistoryDiffModal
          itemA={diffModalItems[0]}
          itemB={diffModalItems[1]}
          onClose={() => setDiffModalItems(null)}
        />
      )}

      {toolMenu && (
        <ContextMenu x={toolMenu.x} y={toolMenu.y} items={toolMenuItems} onClose={() => setToolMenu(null)} />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}
      {movePick && (
        <ContextMenu
          x={movePick.x} y={movePick.y}
          items={collections
            .filter((t) => t.id !== movePick.fromId)
            .map((t) => {
              const n = t.rootRequestIds.length + t.folders.reduce((a, f) => a + f.requestIds.length, 0);
              return {
                label: `➡ ${t.name} (${n})`,
                onClick: () => {
                  moveRequestToCollection(movePick.fromId, movePick.requestId, t.id, 'root');
                  setColOpen(t.id, true);
                },
              };
            })}
          onClose={() => setMovePick(null)}
        />
      )}
      {showCurl && <CurlImport onClose={() => setShowCurl(false)} />}
      {extract && (
        <ExtractVarsDialog
          initialCollectionId={extract.colId}
          initialFolderId={extract.folderId}
          onClose={() => setExtract(null)}
        />
      )}
      {scriptEdit && (() => {
        const col = collections.find((x) => x.id === scriptEdit.colId);
        if (!col) return null;
        const fld = scriptEdit.folderId ? col.folders.find((x) => x.id === scriptEdit.folderId) : undefined;
        if (scriptEdit.folderId && !fld) return null;
        const value = {
          preRequest: (fld ?? col).preRequest ?? '',
          tests: (fld ?? col).tests ?? '',
          ...(fld ? {} : { teardown: col.teardown ?? '' }),
        };
        return (
          <ScriptEditorModal
            title={fld ? `Script folder “${fld.name}”` : `Script collection “${col.name}”`}
            showTeardown={!fld}
            subtitle={
              fld
                ? 'Chạy cho mọi request trong folder này (sau script collection, trước script của request).'
                : 'Chạy cho mọi request trong collection, kể cả khi chạy từng request ở tab Builder. Ô "Dọn dẹp" chỉ chạy khi chạy cả đợt ở Runner / reqx run.'
            }
            value={value}
            onSave={(v) => {
              if (fld) setFolderScripts(col.id, fld.id, v);
              else setCollectionScripts(col.id, v);
            }}
            onClose={() => setScriptEdit(null)}
          />
        );
      })()}
      {showOpenApi && <OpenApiImportModal onClose={() => setShowOpenApi(false)} />}
      {showTreeModal && <TreeStructureModal isOpen={showTreeModal} onClose={() => setShowTreeModal(false)} />}
    </div>
  );
}
