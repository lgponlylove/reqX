import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/app';
import { useRequestStore } from '../stores/request';
import { useFlowStore } from '../stores/flow';
import { importPostmanCollection, exportCollection, exportAllCollections, isFlowContainer } from '../lib/postman-io';
import { importAnyJson, summarizeImport, type AnyImportResult } from '../lib/import-any';
import { buildBackup } from '../lib/backup';
import { saveExportBesideApp, revealExportedFile } from '../lib/response-file';
import { uid } from '../lib/variables';
import EnvironmentManager from './EnvironmentManager';
import ContextMenu, { type MenuItem } from './ContextMenu';
import CurlImport from './CurlImport';
import type { ApiRequest, Collection, Dir, HttpMethod } from '../types/api';

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
    addCollection, renameCollection, deleteCollection, removeRequestFromCollection,
    duplicateRequest,
    addDir, renameDir, deleteDir, moveCollection,
    addFolder, renameFolder, deleteFolder, moveRequest, moveRequestToCollection,
    saveRequest,
    removeHistoryItem, clearHistory, importData,
  } = useAppStore();
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
  const [showCurl, setShowCurl] = useState(false);
  /** Tab sidebar: collections hoặc lịch sử (lịch sử ẩn đi cho gọn) */
  const [sideTab, setSideTab] = useState<'col' | 'his'>('col');
  const [pendingImport, setPendingImport] = useState<{ collection: Collection; reqs: ApiRequest[] } | null>(null);
  const [pendingDir, setPendingDir] = useState('');
  const [addingDir, setAddingDir] = useState(false);
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
  /** Mở/thu hết collections cùng lúc */
  const setAllCols = (open: boolean) => {
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const c of collections) next[`col:${c.id}`] = !open;
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
  /** Chọn đích khi dùng menu "Chuyển sang collection…" (không cần kéo-thả) */
  const [movePick, setMovePick] = useState<{ requestId: string; fromId: string; x: number; y: number } | null>(null);
  /** {id request cần rename, số thứ tự} — ReqRow đúng id sẽ mở ô sửa tên */
  const [renameReqSig, setRenameReqSig] = useState<{ id: string; n: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      // Bung collection đích ra để thấy request vừa chuyển tới
      setColOpen(collectionId, true);
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

  function onDropCol(e: React.DragEvent, dirId: string | null, key: string) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
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
          buildBackup(collections, Object.values(requests), flows),
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

  /** Items cho menu chuột phải đang mở (thư mục / collection / folder / request). */
  function menuItems(): MenuItem[] {
    if (!menu) return [];
    if (menu.kind === 'dir' && menu.dirId) {
      const d = dirs.find((x) => x.id === menu.dirId);
      if (!d) return [];
      return [
        {
          label: '＋ Collection mới ở đây',
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
        { label: '✎ Đổi tên thư mục', onClick: () => setDirRenaming({ id: d.id, text: d.name }) },
        {
          label: '🗑 Xóa thư mục (giữ collections)', danger: true,
          onClick: () => {
            if (confirm(`Xóa thư mục "${d.name}"? Các collection bên trong chuyển ra ngoài.`)) {
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
      return [
        { label: '📂 Mở request', onClick: () => load(r) },
        { label: '⧉ Nhân bản request', onClick: () => duplicateRequest(c.id, r.id) },
        {
          label: '➡ Chuyển sang collection…',
          onClick: () => setMovePick({ requestId: r.id, fromId: c.id, x: menu.x, y: menu.y }),
        },
        {
          label: '✎ Đổi tên request',
          onClick: () => setRenameReqSig((s) => ({ id: r.id, n: (s?.n ?? 0) + 1 })),
        },
        {
          label: '🗑 Xóa request khỏi collection', danger: true,
          onClick: () => {
            if (confirm(`Xóa request "${r.name || r.url}" khỏi collection?`)) {
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
        { label: '✎ Đổi tên folder', onClick: () => { setRenamingFolder(f.id); setRenamingFolderText(f.name); } },
        {
          label: '🗑 Xóa folder (requests chuyển ra ngoài)', danger: true,
          onClick: () => {
            if (confirm(`Xóa folder "${f.name}"? Requests bên trong sẽ chuyển ra ngoài.`)) {
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
        label: `▶ Chạy flow: ${f.name}`,
        onClick: () => {
          requestFlowRun(f.id);
          onGoFlow?.();
        },
      } as MenuItem)),
      { label: '💾 Lưu request hiện tại vào đây', onClick: () => { const saved = current.id && requests[current.id] ? saveRequest(current) : saveRequest(current, c.id); if (saved) { set({ id: saved.id, origin: undefined }); markClean(); } } },
      { label: '📁 Tạo folder mới', onClick: () => setAddingFolderFor(c.id) },
      ...dirs
        .filter((d) => d.id !== curDir?.id)
        .map((d) => ({
          label: `→ 📁 ${d.name}`,
          onClick: () => moveCollection(c.id, d.id),
        })),
      ...(curDir
        ? [{ label: '→ Ngoài thư mục', onClick: () => moveCollection(c.id, null) } as MenuItem]
        : []),
      { label: '📤 Xuất collection ra JSON', onClick: () => exportCol(c) },
      { label: '✎ Đổi tên collection', onClick: () => { setRenamingId(c.id); setRenamingText(c.name); } },
      {
        label: '🗑 Xóa collection (kèm requests)', danger: true,
        onClick: () => {
          if (confirm(`Xóa collection "${c.name}" và mọi request bên trong?`)) {
            deleteCollection(c.id);
          }
        },
      },
    ];
  }

  type Block = { t: 'dir'; key: string; dir: Dir | null } | { t: 'col'; col: Collection };
  const unfiled = collections.filter((c) => !dirs.some((d) => d.collectionIds.includes(c.id)));
  const blocks: Block[] = [];
  for (const d of dirs) {
    blocks.push({ t: 'dir', key: `dir-${d.id}`, dir: d });
    if (collapsed[d.id]) continue;
    for (const cid of d.collectionIds) {
      const col = collections.find((x) => x.id === cid);
      if (col) blocks.push({ t: 'col', col });
    }
  }
  if (dirs.length === 0) {
    for (const c of collections) blocks.push({ t: 'col', col: c });
  } else if (unfiled.length > 0) {
    blocks.push({ t: 'dir', key: 'dir-unfiled', dir: null });
    if (!collapsed['unfiled']) {
      for (const c of unfiled) blocks.push({ t: 'col', col: c });
    }
  }

  const commitNewDir = () => {
    if (dirName.trim()) addDir(dirName.trim());
    setDirName('');
    setAddingDir(false);
  };

  /** Tiêu đề thư mục = nắp hộp bao nhóm collection: rename inline + menu + nhận kéo-thả. */
  const renderDirHeader = (dir: Dir | null, key: string) => {
    const dkey = dir?.id ?? 'unfiled';
    const count = dir ? dir.collectionIds.length : unfiled.length;
    const label = dir ? dir.name : 'Ngoài thư mục';
    // Thu gọn hoặc rỗng → bo tròn cả hộp (không có card nào bên dưới)
    const isCollapsed = !!collapsed[dkey];
    const empty = (!!dir && dir.collectionIds.length === 0) || isCollapsed;
    const hasTargetCol = dir ? dir.collectionIds.length > 0 : unfiled.length > 0;
    return (
      <div
        key={key}
        className={`${compact ? 'mt-1' : 'mt-2'} flex items-center gap-1 bg-slate-800/70 border border-slate-700 ${
          empty ? 'rounded-lg' : 'rounded-t-lg border-b-0'
        } ${dropCls(`dir:${dkey}`)} ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1.5'}`}
        title="Thả collection vào đây • Thả request → collection đầu tiên trong thư mục"
        onDragOver={(e) => {
          const t = e.dataTransfer.types;
          const acceptCol = t.includes('application/x-postman-col');
          const acceptReq = hasTargetCol && t.includes('application/x-postman-req');
          if (acceptCol || acceptReq) {
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
            📁 {label} <span className="text-slate-500 font-normal">({count})</span>
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
    { label: '📁 Xem collections', onClick: () => setSideTab('col') },
    { label: '＋ Collection mới', onClick: () => quickAddCollection() },
    { label: '＋ Thư mục mới', onClick: () => { setDirName(''); setAddingDir(true); setSideTab('col'); } },
    { label: '⤓ Import file JSON', onClick: () => fileRef.current?.click() },
    { label: '📤 Xuất TẤT CẢ collections', onClick: () => exportAll() },
    { label: '💾 Backup full (collections + flows)', onClick: () => exportBackup() },
    { label: '＞_ Import từ curl', onClick: () => setShowCurl(true) },
  ];

  return (
    <div className="flex flex-col gap-2 text-sm">
      {/* Tiêu đề + icon 📁/🕘 + thu gọn: gộp 1 dòng */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold tracking-wide text-slate-400">COLLECTIONS</span>
        <input
          ref={fileRef} type="file" accept=".json" multiple className="hidden"
          onChange={(e) => { if (e.target.files?.length) onImportFiles(e.target.files); e.target.value = ''; }}
        />
        <div className="flex-1" />
        <button
          onClick={(e) => setToolMenu({ x: e.clientX, y: e.clientY })}
          title="Collections — bấm để mở menu (mới / import / curl)"
          className={`rounded px-2 py-1.5 text-xs ${sideTab === 'col' ? 'bg-slate-700 font-bold' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          📁 ▾
        </button>
        <button
          onClick={() => setSideTab('his')}
          title={`Lịch sử (${history.length})`}
          className={`rounded px-2 py-1.5 text-xs ${sideTab === 'his' ? 'bg-slate-700 font-bold' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          🕘{history.length > 0 && <span className="ml-0.5">{history.length}</span>}
        </button>
        <button
          onClick={onCollapse}
          title="Thu gọn sidebar"
          className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded px-1.5 py-1.5 text-xs"
        >
          «
        </button>
      </div>
      {toolMenu && (
        <ContextMenu x={toolMenu.x} y={toolMenu.y} items={toolMenuItems} onClose={() => setToolMenu(null)} />
      )}

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
              <option value="">Ngoài thư mục</option>
              {dirs.map((d) => (
                <option key={d.id} value={d.id}>📁 {d.name}</option>
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

      <EnvironmentManager />

      {sideTab === 'col' && (
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold">Collections ({collections.length})</h3>
          <div className="flex gap-1 text-xs">
            <button onClick={() => setAllCols(true)} title="Mở hết collections" className="text-slate-400 hover:text-white px-1">Mở hết</button>
            <button onClick={() => setAllCols(false)} title="Thu hết collections" className="text-slate-400 hover:text-white px-1">Thu hết</button>
            <button
              onClick={toggleCompact}
              title={compact ? 'Đang gọn — bấm để về cỡ rộng' : 'Đang rộng — bấm để gọn lại, hiện được nhiều hơn'}
              className={`rounded px-1.5 py-0.5 ${compact ? 'bg-slate-700 font-bold' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              {compact ? 'Gọn ✓' : 'Gọn'}
            </button>
          </div>
        </div>
        {addingDir && (
          <div className="flex gap-1 mb-2">
            <input
              autoFocus
              className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs"
              placeholder="Tên thư mục..."
              value={dirName}
              onChange={(e) => setDirName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewDir();
                if (e.key === 'Escape') setAddingDir(false);
              }}
            />
            <button onClick={commitNewDir} className="bg-slate-700 hover:bg-slate-600 rounded px-2 text-xs">
              OK
            </button>
          </div>
        )}
        {collections.length === 0 && <p className="text-slate-500">Chưa có. Hãy tạo hoặc Import.</p>}
        {blocks.map((b, bi) => {
          if (b.t === 'dir') return renderDirHeader(b.dir, b.key);
          const c = b.col;
          // Collection mặc định thu gọn 1 dòng kiểu Postman (mở khi đang sửa tên/tạo folder)
          const colKey = `col:${c.id}`;
          const colOpen = !(collapsed[colKey] ?? true) || renamingId === c.id || addingFolderFor === c.id;
          // Card nằm trong thư mục → bỏ viền riêng, nối liền thành 1 hộp với nắp thư mục
          const bare = dirs.some((d) => d.collectionIds.includes(c.id));
          const isLast = bi === blocks.length - 1 || blocks[bi + 1]?.t === 'dir';
          // Chế độ gọn: đúng 1 dòng/dòng collection kiểu Postman (mũi tên + tên + số request)
          const totalReqs = c.rootRequestIds.length + c.folders.reduce((a, f) => a + f.requestIds.length, 0);
          return (
          <div
            key={c.id}
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
                    title={colOpen ? 'Thu gọn collection' : 'Mở rộng collection'}
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
                    {c.name} <span className="text-slate-500 font-normal">({totalReqs})</span>
                  </b>
                </>
              )}
            </div>

            {colOpen && (
            <>
            {/* Folders */}
            {c.folders.map((f) => (
              <div
                key={f.id}
                className={`${compact ? 'mt-0.5' : 'mt-1.5'} ml-1 border-l-2 border-slate-700 pl-1.5 ${dropCls(`${c.id}:${f.id}`)}`}
                onDragOver={(e) => { e.preventDefault(); setDropTarget(`${c.id}:${f.id}`); }}
                onDragLeave={() => setDropTarget((t) => (t === `${c.id}:${f.id}` ? null : t))}
                onDrop={(e) => onDropZone(e, c.id, { folderId: f.id }, `${c.id}:${f.id}`)}
              >
                <div
                  className="flex items-center gap-1 rounded hover:bg-slate-800/60 cursor-context-menu"
                  title={`${f.name} — chuột phải / double-click / F2`}
                  tabIndex={0}
                  onContextMenu={(e) => openMenu(e, { kind: 'folder', colId: c.id, folderId: f.id })}
                  onDoubleClick={() => { setRenamingFolder(f.id); setRenamingFolderText(f.name); }}
                  onKeyDown={(e) => {
                    if (e.key === 'F2' && renamingFolder !== f.id) {
                      e.preventDefault();
                      setRenamingFolder(f.id);
                      setRenamingFolderText(f.name);
                    }
                  }}
                >
                  {renamingFolder === f.id ? (
                    <input
                      autoFocus
                      className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs"
                      value={renamingFolderText}
                      onChange={(e) => setRenamingFolderText(e.target.value)}
                      onBlur={() => {
                        if (renamingFolderText.trim()) renameFolder(c.id, f.id, renamingFolderText.trim());
                        setRenamingFolder(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && renamingFolderText.trim()) {
                          renameFolder(c.id, f.id, renamingFolderText.trim());
                          setRenamingFolder(null);
                        }
                        if (e.key === 'Escape') setRenamingFolder(null);
                      }}
                    />
                  ) : (
                    <span className="flex-1 truncate text-xs font-semibold text-slate-300" title={f.name}>
                      📁 {f.name} <span className="text-slate-500">({f.requestIds.length})</span>
                    </span>
                  )}
                </div>
                {f.requestIds.map((id) => {
                  const r = requests[id];
                  if (!r) return null;
                  return <ReqRow key={id} collectionId={c.id} req={r} compact={compact} onDragStart={onDragStart} onDragEnd={() => setDropTarget(null)} onMenu={(e, colId, requestId) => openMenu(e, { kind: 'request', colId, requestId })} renameSignal={renameReqSig?.id === id ? renameReqSig.n : 0} />;
                })}
                {f.requestIds.length === 0 && (
                  <p className="text-[11px] text-slate-600 italic px-2 py-0.5">Kéo request vào đây</p>
                )}
              </div>
            ))}

            {/* Thêm folder */}
            {addingFolderFor === c.id && (
              <div className="flex gap-1 mt-1.5">
                <input
                  autoFocus
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-xs"
                  placeholder="Tên folder..."
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && folderName.trim()) {
                      addFolder(c.id, folderName.trim());
                      setFolderName('');
                      setAddingFolderFor(null);
                    }
                    if (e.key === 'Escape') setAddingFolderFor(null);
                  }}
                />
                <button
                  onClick={() => {
                    if (folderName.trim()) addFolder(c.id, folderName.trim());
                    setFolderName('');
                    setAddingFolderFor(null);
                  }}
                  className="bg-slate-700 hover:bg-slate-600 rounded px-2 text-xs"
                >
                  OK
                </button>
              </div>
            )}

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
      <div>
        <div className="flex justify-between items-center mb-1">
          <h3 className="font-semibold">Lịch sử ({history.length})</h3>
          {history.length > 0 && (
            <button onClick={clearHistory} className="text-xs text-slate-400 hover:text-red-300">
              Xóa hết
            </button>
          )}
        </div>
        {history.length > 5 && (
          <input
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs mb-1"
            placeholder="Tìm lịch sử (method, url, status)..."
            value={hisQuery}
            onChange={(e) => setHisQuery(e.target.value)}
          />
        )}
        {history
          .filter((h) => {
            const q = hisQuery.trim().toLowerCase();
            if (!q) return true;
            return (
              h.request.method.toLowerCase().includes(q) ||
              h.request.url.toLowerCase().includes(q) ||
              String(h.responseStatus).includes(q)
            );
          })
          .slice(0, 20)
          .map((h) => (
            <div
              key={h.id}
              className="group flex items-center rounded hover:bg-slate-800"
            >
              <button
                onClick={() => load(h.request)}
                className="flex-1 min-w-0 text-left px-2 py-1 font-mono text-xs text-slate-300 truncate"
              >
                <span className="text-sky-300 font-bold">{h.responseStatus}</span> {h.request.method} {h.request.url.slice(0, 50)}
              </button>
              <button
                title="Xóa dòng này"
                onClick={() => removeHistoryItem(h.id)}
                className="px-2 text-slate-600 group-hover:text-slate-400 hover:!text-red-300 text-xs"
              >
                ✕
              </button>
            </div>
          ))}
      </div>
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
    </div>
  );
}
