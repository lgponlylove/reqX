import { describe, expect, it } from 'vitest';
import { scriptChainFor, folderPathOf } from '../script-chain';
import { importPostmanCollection, collectionToPostman } from '../postman-io';
import type { ApiRequest, Collection, Folder } from '../../types/api';

const req = (id: string, pre = '', tests = ''): ApiRequest => ({
  id, name: id, method: 'GET', url: 'https://x.test', params: [], headers: [],
  bodyType: 'none', body: '', auth: { type: 'none' }, preRequest: pre, tests,
  updatedAt: 1, collectionId: 'col',
});

const folder = (id: string, name: string, requestIds: string[], folderIds: string[] = [], pre = '', tests = ''): Folder =>
  ({ id, name, requestIds, folderIds, preRequest: pre, tests });

describe('scriptChainFor — thứ tự kế thừa script', () => {
  const col: Collection = {
    id: 'col',
    name: 'C',
    rootRequestIds: [],
    preRequest: 'COLLECTION_PRE',
    tests: 'COLLECTION_TEST',
    folders: [
      folder('f1', 'A', [], ['f2'], 'FOLDER1_PRE', 'FOLDER1_TEST'),
      folder('f2', 'B', ['r1'], [], 'FOLDER2_PRE', 'FOLDER2_TEST'),
    ],
  };

  it('pre-request chạy từ ngoài vào trong: collection → folder cha → folder con → request', () => {
    const chain = scriptChainFor([col], req('r1', 'REQ_PRE'));
    expect(chain.pre).toEqual(['COLLECTION_PRE', 'FOLDER1_PRE', 'FOLDER2_PRE', 'REQ_PRE']);
  });

  it('tests chạy ngược lại: request → folder con → folder cha → collection', () => {
    const chain = scriptChainFor([col], req('r1', '', 'REQ_TEST'));
    expect(chain.tests).toEqual(['REQ_TEST', 'FOLDER2_TEST', 'FOLDER1_TEST', 'COLLECTION_TEST']);
  });

  it('bỏ script trống, không làm hỏng chuỗi', () => {
    const bare: Collection = { ...col, preRequest: '  ', tests: '  ', folders: [folder('f1', 'A', ['r1'], [], '', '  ')] };
    const chain = scriptChainFor([bare], req('r1', 'REQ_PRE', 'REQ_TEST'));
    expect(chain.pre).toEqual(['REQ_PRE']);
    expect(chain.tests).toEqual(['REQ_TEST']);
  });

  it('request ở root (không trong folder) chỉ kế thừa script collection', () => {
    const chain = scriptChainFor([col], req('r9', 'REQ_PRE'));
    expect(chain.pre).toEqual(['COLLECTION_PRE', 'REQ_PRE']);
  });

  it('folderPathOf trả đường dẫn từ gốc xuống folder chứa request', () => {
    expect(folderPathOf(col, 'r1').map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(folderPathOf(col, 'missing')).toEqual([]);
  });
});

describe('importPostmanCollection — đọc mảng event của Postman', () => {
  const pm = {
    info: { name: 'Sys' },
    event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ['pm.env.set("a","1")', '// dong 2'] } }],
    item: [
      {
        name: 'Auth',
        event: [{ listen: 'test', script: { exec: ['pm.test("folder test", () => {});'] } }],
        item: [
          {
            name: 'Login',
            event: [{ listen: 'prerequest', script: { exec: ['// request pre'] } }],
            request: { method: 'POST', url: 'https://x.test/login' },
          },
        ],
      },
    ],
  };

  it('gán script cho collection, folder lẫn request đúng chỗ', () => {
    const { collection, requests } = importPostmanCollection(pm);
    expect(collection.preRequest).toBe('pm.env.set("a","1")\n// dong 2');
    expect(collection.tests).toBe('');
    expect(collection.folders[0].tests).toBe('pm.test("folder test", () => {});');
    expect(requests[0].preRequest).toBe('// request pre');
  });

  it('import rồi giải chuỗi: request nhận đủ collection + folder + của nó', () => {
    const { collection, requests } = importPostmanCollection(pm);
    const chain = scriptChainFor([collection], requests[0]);
    expect(chain.pre).toEqual(['pm.env.set("a","1")\n// dong 2', '// request pre']);
    expect(chain.tests).toEqual(['pm.test("folder test", () => {});']);
  });

  it('xuất lại ra Postman giữ đủ event ở cả ba mức', () => {
    const { collection, requests } = importPostmanCollection(pm);
    const out = collectionToPostman(collection, new Map(requests.map((r) => [r.id, r])));
    expect(out.event?.[0].listen).toBe('prerequest');
    const folderItem = out.item[0] as { event?: Array<{ listen: string }>; item?: Array<{ event?: unknown }> };
    expect(folderItem.event?.[0].listen).toBe('test');
    expect(folderItem.item?.[0].event).toBeTruthy();
  });

  it('không thêm event rác khi không có script', () => {
    const { collection, requests } = importPostmanCollection({
      info: { name: 'Clean' },
      item: [{ name: 'R', request: { method: 'GET', url: 'https://x.test' } }],
    });
    const out = collectionToPostman(collection, new Map(requests.map((r) => [r.id, r])));
    expect(out.event).toBeUndefined();
    expect((out.item[0] as { event?: unknown }).event).toBeUndefined();
  });
});
